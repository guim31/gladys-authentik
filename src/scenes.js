// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// - get_status: sums up authentik for a message (failed and successful
//   logins, outposts, the latest failure), what a condition on the device
//   cannot put in words. It reads authentik again when the last read is older
//   than 15 seconds. Nothing in authentik can be changed from Gladys: the
//   token is read-only by design.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async get_status(hub) {
    if (!hub.client) {
      hub.assertReadable(); // no address or token: the configuration to fix
    }
    await hub.refreshIfStale();
    const language = hub.config.language;
    const sentence = `${hub.summary(language)}.`;
    if (hub.failing || !hub.reachable) {
      // "authentik does not answer" is an answer: the scene goes on with it.
      return {
        reachable: false,
        failed_logins_1h: 0,
        failed_logins_24h: 0,
        logins_24h: 0,
        outposts_online: 0,
        outposts_total: 0,
        version: '',
        last_failed_username: '',
        last_failed_ip: '',
        sentence,
      };
    }
    const counts = hub.counts();
    const outposts = hub.outpostCounts() ?? { online: 0, total: 0 };
    const lastFailed = hub.latestOf('login_failed');
    return {
      reachable: true,
      failed_logins_1h: counts.failed1h,
      failed_logins_24h: counts.failed24h,
      logins_24h: counts.logins24h,
      outposts_online: outposts.online,
      outposts_total: outposts.total,
      version: hub.version?.current ?? '',
      last_failed_username: lastFailed?.username ?? '',
      last_failed_ip: lastFailed?.ip ?? '',
      sentence,
    };
  },
};
