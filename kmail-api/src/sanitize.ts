import sanitizeHtml from "sanitize-html";

// Email HTML is hostile input. No scripts, styles, forms or event handlers survive; remote images
// are removed unless the user asks for them (tracking pixels). The web app also renders the result in
// a sandboxed iframe, so this is defence in depth.
export function cleanHtml(html: string, allowRemoteImages: boolean): { html: string; blockedRemote: boolean } {
  let blockedRemote = false;
  const out = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "span", "center", "font"],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan", "align", "valign", "width"],
      th: ["colspan", "rowspan", "align", "valign", "width"],
      table: ["width", "align", "border", "cellpadding", "cellspacing"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: allowRemoteImages ? ["data", "http", "https"] : ["data"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
      img: (tag, attribs) => {
        if (!allowRemoteImages && /^(https?:)?\/\//i.test(attribs.src ?? "")) blockedRemote = true;
        return { tagName: tag, attribs };
      },
    },
  });
  return { html: out, blockedRemote };
}
