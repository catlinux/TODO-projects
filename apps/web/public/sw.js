/* Service worker de avisos push: sin dependencias ni empaquetado. */

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }

  const titulo = typeof datos.titulo === "string" && datos.titulo ? datos.titulo : "Recordatorio";
  const cuerpo = typeof datos.cuerpo === "string" ? datos.cuerpo : "";
  const url = typeof datos.urlRelativa === "string" && datos.urlRelativa ? datos.urlRelativa : "/";

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const datos = event.notification.data || {};
  const url = typeof datos.url === "string" && datos.url ? datos.url : "/";

  event.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const cliente of clientes) {
        if ("focus" in cliente) {
          await cliente.focus();
          if ("navigate" in cliente && cliente.url !== url) {
            await cliente.navigate(url);
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
