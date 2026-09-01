import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAYA_HOSTS = {
  sandbox: "https://pg-sandbox.paymaya.com",
  production: "https://pg.paymaya.com",
};

function basicAuth(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function mayaHost() {
  return process.env.MAYA_ENVIRONMENT === "production" ? MAYA_HOSTS.production : MAYA_HOSTS.sandbox;
}

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey || !serviceKey) throw new Error("Supabase payment configuration is incomplete.");
  return {
    auth: createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

function paymentStatus(payment: Record<string, unknown>) {
  return String(payment.status || payment.paymentStatus || "").toUpperCase();
}

function paymentAmount(payment: Record<string, unknown>) {
  const total = payment.totalAmount;
  const value = total && typeof total === "object" ? (total as Record<string, unknown>).value : payment.amount;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export async function GET(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const { auth, admin } = clients();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ error: "Session expired." }, { status: 401 });

    const url = new URL(request.url);
    const orderId = url.searchParams.get("order");
    let query = admin
      .from("picklester_maya_orders")
      .select("id,user_id,product_code,amount,currency,status,request_reference_number,maya_payment_id,created_at")
      .eq("user_id", userData.user.id);

    query = orderId
      ? query.eq("id", orderId)
      : query.in("status", ["created", "pending", "updated", "review"]).gte("created_at", new Date(Date.now() - 86400000).toISOString()).order("created_at", { ascending: false }).limit(1);

    const { data: order, error: orderError } = await query.maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ status: "none" });
    if (order.status === "paid") return NextResponse.json({ status: "paid", productCode: order.product_code });

    const secretKey = process.env.MAYA_SECRET_KEY;
    if (!secretKey) throw new Error("Maya secret key is not configured.");
    const mayaResponse = await fetch(
      `${mayaHost()}/payments/v1/payment-rrns/${encodeURIComponent(order.request_reference_number)}`,
      { headers: { Authorization: basicAuth(secretKey) }, cache: "no-store" },
    );
    const payment = (await mayaResponse.json().catch(() => ({}))) as Record<string, unknown>;
    console.log("[maya/order-status] reconciliation", { orderId: order.id, mayaStatus: paymentStatus(payment), httpStatus: mayaResponse.status });
    if (!mayaResponse.ok) return NextResponse.json({ status: "pending", productCode: order.product_code });

    const status = paymentStatus(payment);
    const amount = paymentAmount(payment);
    const currency = String(payment.currency || (payment.totalAmount && typeof payment.totalAmount === "object" ? (payment.totalAmount as Record<string, unknown>).currency : "") || "").toUpperCase();
    const successful = status === "PAYMENT_SUCCESS" || status === "SUCCESS";
    const amountMatches = amount === null || amount === Number(order.amount);
    const currencyMatches = !currency || currency === String(order.currency).toUpperCase();

    if (!successful || !amountMatches || !currencyMatches) {
      return NextResponse.json({ status: successful ? "review" : "pending", productCode: order.product_code });
    }

    const paymentId = String(payment.id || payment.paymentId || order.maya_payment_id || "") || null;
    const { error: fulfillError } = await admin.rpc("fulfill_picklester_maya_order", {
      order_id: order.id,
      maya_payment_id_input: paymentId,
      webhook_payload_input: { source: "return_status_reconciliation" },
      maya_response_input: payment,
    });
    if (fulfillError) throw fulfillError;
    console.log("[maya/order-status] fulfilled", { orderId: order.id, productCode: order.product_code });
    return NextResponse.json({ status: "paid", productCode: order.product_code });
  } catch (error) {
    console.error("[maya/order-status] failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment verification failed." }, { status: 500 });
  }
}
