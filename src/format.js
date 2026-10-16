// Dates from the hub are ISO timestamps; the CLI shows the day part of them.
export const day = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "unknown date");

export const printJson = (log, value) => log.raw(JSON.stringify(value, null, 2));
