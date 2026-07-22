export class AnimeFilterList extends Array {
  constructor(...args) {
    super(...args);
  }
}

export class SAnime {
  static create() {
    return {
      url: "",
      title: "",
      thumbnailUrl: "",
      status: "",
      description: "",
      initialized: false
    };
  }
}

export class SEpisode {
  static create() {
    return {
      url: "",
      name: "",
      episodeNumber: 0
    };
  }
}

export class Video {
  constructor(url, quality, videoUrl) {
    this.url = url;
    this.quality = quality;
    this.videoUrl = videoUrl;
  }
}

export const STATUS = {
  COMPLETED: "COMPLETED",
  ONGOING: "ONGOING",
  UNKNOWN: "UNKNOWN"
};