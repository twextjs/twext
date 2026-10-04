import { resolveHubUrl, resolveToken, searchExtensions } from "../hub.js";

const SORTS = ["recent", "downloads", "updated", "name"];

export async function searchCommand(product, terms, { url, token, sort }, log) {
  if (sort !== undefined && !SORTS.includes(sort)) {
    log.error(`--sort must be one of ${SORTS.join(", ")}.`);
    return false;
  }
  const hub = resolveHubUrl(url);
  const query = terms.join(" ").trim();

  let page;
  try {
    page = await searchExtensions(hub, query, sort, resolveToken(token, hub));
  } catch (err) {
    log.error(err.message);
    return false;
  }

  const results = page?.data ?? [];
  if (results.length === 0) {
    log.info(query ? `No extensions matched "${query}".` : "The registry has no extensions yet.");
    return true;
  }
  log.info(
    `${results.length} extension${results.length === 1 ? "" : "s"}${query ? ` matching "${query}"` : ""}`,
  );
  for (const extension of results) {
    const description = extension.description ?? "";
    const summary = description.length > 90 ? `${description.slice(0, 89)}…` : description;
    log.bullet(
      `${extension.name} (@${extension.namespace}/${extension.id}@${extension.version})${summary ? ` — ${summary}` : ""}`,
    );
  }
  return true;
}
