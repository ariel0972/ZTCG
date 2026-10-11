// No fetch handler or cache: all pages and game data continue using the network.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL("/HTML/friends.html#invites", self.location.origin)
        .href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        client.postMessage({
          type: "social:open-invites",
          userId: event.notification.data?.userId,
        });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
