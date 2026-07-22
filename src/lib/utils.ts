import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTitle(title: string): string {
  return title
    .replace(/download/gi, '')
    .replace(/\[.*?\]/g, '')
    .trim()
}

export function extractQuality(text: string): string {
  const qualityMatch = text.match(/\d{3,4}p/i);
  return qualityMatch ? qualityMatch[0] : 'HD';
}

export function formatFileSize(sizeText: string): string {
  const sizeMatch = sizeText.match(/\[(.*?)\]/);
  return sizeMatch ? sizeMatch[1] : '';
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
