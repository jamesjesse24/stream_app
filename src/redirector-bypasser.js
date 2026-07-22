import * as cheerio from 'cheerio';
import FormData from 'form-data';

class RedirectorBypasser {
  constructor(client, headers) {
    this.client = client;
    this.headers = headers;
    this.mutex = Promise.resolve();
  }

  async bypass(url) {
    try {
      const lastDoc = await this.getDocument(url);
      const doc = await this.recursiveDoc(lastDoc);
      
      const scripts = cheerio.load(doc.html())("script");
      let script = null;
      
      scripts.each((index, element) => {
        const scriptContent = cheerio.load(doc.html())(element).html();
        if (scriptContent && scriptContent.includes("?go=") && scriptContent.includes("href")) {
          script = scriptContent;
          return false; // break
        }
      });
      
      if (!script) return null;

      const nextUrlMatch = script.match(/"href","([^"]+)"/);
      if (!nextUrlMatch) return null;
      
      const nextUrl = nextUrlMatch[1];
      const urlObj = new URL(nextUrl);
      const cookieName = urlObj.searchParams.get("go");
      
      if (!cookieName) return null;

      const cookieValueMatch = script.match(new RegExp(`'${cookieName}', '([^']+)'`));
      if (!cookieValueMatch) return null;
      
      const cookieValue = cookieValueMatch[1];
      
      // Use mutex to prevent cookie conflicts in parallel requests
      return await this.withMutex(async () => {
        // Set cookie
        const cookie = `${cookieName}=${cookieValue}`;
        const headers = {
          ...this.headers,
          'Cookie': cookie,
          'Referer': doc.url
        };

        const response = await this.client.get(nextUrl, { headers });
        const $ = cheerio.load(response.data);
        
        const metaRefresh = $("meta[http-equiv]").attr("content");
        if (metaRefresh && metaRefresh.includes("url=")) {
          return metaRefresh.split("url=")[1];
        }
        
        return null;
      });
    } catch (error) {
      console.error(`Error bypassing redirector: ${error.message}`);
      return null;
    }
  }

  async recursiveDoc(doc) {
    const $ = cheerio.load(doc.html());
    const form = $("#landing");
    
    if (!form.length) return doc;

    const action = form.attr("action");
    const formData = new FormData();
    
    form.find("input").each((index, element) => {
      const $input = $(element);
      const name = $input.attr("name");
      const value = $input.attr("value");
      if (name && value !== undefined) {
        formData.append(name, value);
      }
    });

    const headers = {
      ...this.headers,
      'Referer': doc.url,
      ...formData.getHeaders()
    };

    try {
      const response = await this.client.post(action, formData, { headers });
      const newDoc = {
        html: () => response.data,
        url: response.config.url || action
      };
      
      return await this.recursiveDoc(newDoc);
    } catch (error) {
      console.error(`Error in recursive doc processing: ${error.message}`);
      return doc;
    }
  }

  async getDocument(url) {
    const response = await this.client.get(url, { headers: this.headers });
    return {
      html: () => response.data,
      url: response.config.url || url
    };
  }

  async withMutex(fn) {
    const currentMutex = this.mutex;
    let resolve;
    this.mutex = new Promise(r => resolve = r);
    
    try {
      await currentMutex;
      return await fn();
    } finally {
      resolve();
    }
  }
}

export { RedirectorBypasser };
export default RedirectorBypasser;