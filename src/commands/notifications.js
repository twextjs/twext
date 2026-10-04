import { listNotifications, markNotificationsRead, resolveHubUrl, resolveToken } from "../hub.js";

export async function notificationsCommand(product, { url, read, token: tokenOverride }, log) {
  const hub = resolveHubUrl(url);
  const token = resolveToken(tokenOverride, hub);
  if (!token) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  let page;
  try {
    page = await listNotifications(hub, token);
  } catch (err) {
    log.error(err.message);
    return false;
  }

  const data = page?.data ?? [];
  if (data.length === 0) {
    log.info("No notifications.");
    return true;
  }
  log.info(
    `${data.length} notification${data.length === 1 ? "" : "s"}, ${page.unreadCount} unread (newest first)`,
  );
  for (const notification of data) {
    const state = notification.read ? "" : " (unread)";
    log.bullet(`${notification.kind}${state}: ${notification.message}`);
  }

  if (!read) return true;
  const ids = data.filter((notification) => !notification.read).map((n) => Number(n.id));
  if (ids.length === 0) {
    log.info("Nothing unread to mark.");
    return true;
  }
  try {
    const { updated } = await markNotificationsRead(hub, token, ids);
    log.success(`Marked ${updated} as read`);
    return true;
  } catch (err) {
    log.error(err.message);
    return false;
  }
}
