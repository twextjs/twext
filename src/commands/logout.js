import {
  HubError,
  clearCredentials,
  loadCredentials,
  revokeCurrentSession,
  revokeCurrentToken,
} from "../hub.js";

// A revoked or unknown token has nothing left to end, and an older hub may not
// have the route at all; neither is worth complaining about on the way out.
const nothingLeftToRevoke = (err) =>
  err instanceof HubError && (err.status === 401 || err.status === 404);

export async function logoutCommand(product, log) {
  const { hub, token } = loadCredentials();
  if (hub && token) {
    try {
      await revokeCurrentSession(hub, token);
    } catch (err) {
      // The stored credential is a session in practice; an automation token
      // dropped into the config can only revoke itself.
      if (err instanceof HubError && err.status === 403) {
        try {
          await revokeCurrentToken(hub, token);
        } catch (tokenErr) {
          if (!nothingLeftToRevoke(tokenErr)) {
            log.warn(`Could not revoke the token at ${hub}: ${tokenErr.message}`);
          }
        }
      } else if (!nothingLeftToRevoke(err)) {
        log.warn(`Could not revoke the session at ${hub}: ${err.message}`);
      }
    }
  }
  clearCredentials();
  log.success("Logged out");
  return true;
}
