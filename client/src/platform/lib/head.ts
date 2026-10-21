import type { Head } from '../seo';

/** One head element of index.html and the attribute a Head sets on it. */
export interface HeadWrite {
  selector: string;
  attr: 'content' | 'href';
  value: string;
}

/**
 * The head elements the shell carries and what each takes from a Head: the eight values with the
 * title. The elements stay the shell's; nothing is created, so hydration has nothing to match in
 * the head. twitter:card stays as the shell has it (summary, until the share image lands).
 */
export function headWrites(head: Head): HeadWrite[] {
  return [
    { selector: 'meta[name="description"]', attr: 'content', value: head.description },
    { selector: 'link[rel="canonical"]', attr: 'href', value: head.canonical },
    { selector: 'meta[name="robots"]', attr: 'content', value: head.robots },
    { selector: 'meta[property="og:title"]', attr: 'content', value: head.title },
    { selector: 'meta[property="og:description"]', attr: 'content', value: head.description },
    { selector: 'meta[property="og:url"]', attr: 'content', value: head.canonical },
    { selector: 'meta[property="og:image"]', attr: 'content', value: head.ogImage },
  ];
}

/** What applyHead needs of a document; structural so the build script, checked without the DOM types, can import this module. */
export interface HeadDocument {
  title: string;
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

/** Writes a Head into the document: the title, then each element the shell has (a missing one is skipped). */
export function applyHead(head: Head, doc: HeadDocument): void {
  doc.title = head.title;
  for (const write of headWrites(head)) doc.querySelector(write.selector)?.setAttribute(write.attr, write.value);
}
