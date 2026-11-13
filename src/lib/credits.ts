/**
 * Third-party work used on the site, listed on /credits. Each entry carries
 * what its licence asks for: title, author, source, licence and any changes.
 */
export interface Credit {
  /** What it is used for on the site. */
  use: string;
  title: string;
  url: string;
  author: string;
  authorUrl?: string;
  license: string;
  licenseUrl: string;
  /** How it was changed, if it was. */
  changes?: string;
}

export const photos: Credit[] = [
  {
    use: "Home page hero",
    title: "Wv Karakorum banner",
    url: "https://commons.wikimedia.org/wiki/File:Wv_Karakorum_banner.jpg",
    author: "Tahir Khan Kayani",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    changes:
      "Cropped to K2 and its neighbours, printed as a halftone screen, with the Arize Labs mark drawn over it. This adaptation is shared under the same licence, CC BY-SA 4.0.",
  },
];

export const typefaces: Credit[] = [
  {
    use: "Headings and body text",
    title: "Urbanist",
    url: "https://github.com/coreyhu/Urbanist",
    author: "Corey Hu",
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org/",
  },
  {
    use: "Labels and code",
    title: "Geist Mono",
    url: "https://github.com/vercel/geist-font",
    author: "Vercel",
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org/",
  },
];
