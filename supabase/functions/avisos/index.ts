// Función «avisos» (Supabase Edge Functions): manda como notificación push los avisos pendientes.
// La llama la base apenas se crea un aviso (pg_net) y cada 5 minutos para reintentar (pg_cron).
// Llamarla de más no hace daño: solo envía lo que esté pendiente, y nunca dos veces lo mismo.
//
// Secretos (Supabase → Edge Functions → Secrets; ver README):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   claves de las notificaciones (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT                          https://<dominio de la app> (lo piden Apple y Google)
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID      opcionales, para cuando se sume WhatsApp (todavía no se usa)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";

interface Aviso { id: number; usuario_id: string; tipo: string; titulo: string; cuerpo: string | null; url: string | null; canales: string[] }
interface Suscripcion { id: string; endpoint: string; p256dh: string; auth: string; fallos: number }

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return respuesta({ error: "Faltan las claves VAPID (ver README → Avisos)." }, 500);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || Deno.env.get("SUPABASE_URL")!, pub, priv);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let enviados = 0, sinDispositivo = 0, fallidos = 0;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const { data: avisos, error } = await sb.rpc("tomar_avisos", { p_cantidad: 100 });
    if (error) return respuesta({ error: error.message }, 500);
    if (!avisos?.length) break;
    const usuarios = [...new Set((avisos as Aviso[]).map((a) => a.usuario_id))];
    const { data: subs } = await sb.from("push_suscripciones").select("id,usuario_id,endpoint,p256dh,auth,fallos").in("usuario_id", usuarios);
    const porUsuario = new Map<string, Suscripcion[]>();
    for (const s of subs || []) porUsuario.set(s.usuario_id, [...(porUsuario.get(s.usuario_id) || []), s]);

    for (const a of avisos as Aviso[]) {
      const destinos = porUsuario.get(a.usuario_id) || [];
      if (a.canales.includes("whatsapp")) await whatsapp(sb, a);   // preparado para más adelante
      if (!destinos.length) { await sb.rpc("resultado_aviso", { p_id: a.id, p_enviado: true, p_error: "El usuario no activó los avisos en ningún celular (se ve en la app)." }); sinDispositivo++; continue; }
      const carga = JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo || "", url: a.url || "/", tag: a.tipo === "resumen_diario" ? "resumen" : "aviso-" + a.id, urgente: a.tipo === "maquina_parada" });
      let alguno = false, ultimoError: string | null = null;
      for (const s of destinos) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga,
            { TTL: a.tipo === "resumen_diario" ? 12 * 3600 : 24 * 3600, urgency: a.tipo === "maquina_parada" ? "high" : "normal" });
          alguno = true;
          await sb.from("push_suscripciones").update({ ultimo_envio: new Date().toISOString(), fallos: 0 }).eq("id", s.id);
        } catch (e) {
          const codigo = (e as { statusCode?: number }).statusCode;
          ultimoError = `Push ${codigo ?? ""} ${(e as Error).message || ""}`.trim();
          // 404/410: el celular ya no existe o desactivó los avisos → se borra la suscripción
          if (codigo === 404 || codigo === 410 || s.fallos >= 10) await sb.from("push_suscripciones").delete().eq("id", s.id);
          else await sb.from("push_suscripciones").update({ fallos: s.fallos + 1 }).eq("id", s.id);
        }
      }
      await sb.rpc("resultado_aviso", { p_id: a.id, p_enviado: alguno, p_error: alguno ? null : ultimoError });
      if (alguno) enviados++; else fallidos++;
    }
  }
  return respuesta({ enviados, sinDispositivo, fallidos });
});

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, "Content-Type": "application/json" } });
}

// WhatsApp (WhatsApp Business Cloud API): estructura lista, desactivada hasta configurar el número y una plantilla aprobada.
// deno-lint-ignore no-explicit-any
async function whatsapp(_sb: any, _a: Aviso) {
  if (!Deno.env.get("WHATSAPP_TOKEN") || !Deno.env.get("WHATSAPP_PHONE_ID")) return;
  // Pendiente para cuando se active: leer usuarios.telefono y enviar la plantilla con titulo y cuerpo.
}
