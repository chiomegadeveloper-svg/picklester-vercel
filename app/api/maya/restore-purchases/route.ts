import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey || !serviceKey) throw new Error("Supabase payment configuration is incomplete.");
  return {
    auth: createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const { auth, admin } = getClients();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ error: "Session expired." }, { status: 401 });

    const { data: orders, error: orderError } = await admin
      .from("picklester_maya_orders")
      .select("product_code,pass_days,fulfilled_at")
      .eq("user_id", userData.user.id)
      .eq("status", "paid")
      .order("fulfilled_at", { ascending: false });
    if (orderError) throw orderError;

    const forever = (orders || []).some((order) => order.product_code === "pass_forever" && order.fulfilled_at);
    if (forever) {
      const { error } = await admin.from("profiles").update({
        gamepass_forever: true,
        gamepass_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", userData.user.id);
      if (error) throw error;
      console.log("[maya/restore] forever pass restored", { userId: userData.user.id });
      return NextResponse.json({ restored: true, entitlement: "forever", message: "Forever Pass restored successfully." });
    }

    const now = Date.now();
    const activeExpiry = (orders || []).reduce<number | null>((latest, order) => {
      const days = Number(order.pass_days);
      const fulfilledAt = order.fulfilled_at ? new Date(order.fulfilled_at).getTime() : Number.NaN;
      if (![5, 7, 30].includes(days) || !Number.isFinite(fulfilledAt)) return latest;
      const expiry = fulfilledAt + days * 86400000;
      return expiry > now && (latest === null || expiry > latest) ? expiry : latest;
    }, null);

    if (activeExpiry !== null) {
      const expiresAt = new Date(activeExpiry).toISOString();
      const { error } = await admin.from("profiles").update({
        gamepass_forever: false,
        gamepass_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }).eq("id", userData.user.id);
      if (error) throw error;
      console.log("[maya/restore] timed pass restored", { userId: userData.user.id, expiresAt });
      return NextResponse.json({ restored: true, entitlement: "timed", expiresAt, message: "Your active Game Pass was restored." });
    }

    return NextResponse.json({ restored: false, entitlement: "none", message: "No valid restorable Game Pass was found." });
  } catch (error) {
    console.error("[maya/restore] failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Restore Purchases failed." }, { status: 500 });
  }
}
