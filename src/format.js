// Dates from the hub are ISO timestamps; the CLI shows the day part of them.
export const day = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "unknown date");
