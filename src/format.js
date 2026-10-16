// Dates from the hub are ISO timestamps; the CLI shows the day part of them.
export const day = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "unknown date");

// The hub reports a download count per version; an older hub sends none.
export const downloads = (version) =>
  typeof version.downloads === "number"
    ? `, ${version.downloads} download${version.downloads === 1 ? "" : "s"}`
    : "";

export const printJson = (log, value) => log.raw(JSON.stringify(value, null, 2));
