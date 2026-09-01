import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMayaPassProduct } from "@/app/lib/maya-products";
import { getMayaHost } from "@/app/lib/maya-server";

export const runtime = "nodejs";

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.picklester.asia").replace(/\/$/, "");
}

function basicAuth(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function getServerSupabase(service = false) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = service
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are missing.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  try {
    const publicKey = process.env.MAYA_PUBLIC_KEY;
    if (!publicKey) {
      return NextResponse.json({ error: "Maya public key is not configured." }, { status: 500 });
    }

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const product = getMayaPassProduct(String(body.productCode || ""));
    if (!product) return NextResponse.json({ error: "Choose a valid Shop product." }, { status: 400 });

    const supabase = getServerSupabase();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });

    const admin = getServerSupabase(true);
    const requestReferenceNumber = `PICKLESTER-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const siteUrl = getSiteUrl();

    const { data: order, error: orderError } = await admin
      .from("picklester_maya_orders")
      .insert({
        user_id: user.id,
        product_code: product.code,
        pass_days: product.passDays,
        extra_games: product.extraGames,
        coin_reward: product.coinReward,
        background_code: product.category === "background" ? product.code : null,
        amount: product.amount,
        currency: "PHP",
        request_reference_number: requestReferenceNumber,
        status: "created",
      })
      .select("id")
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: orderError?.message || "Could not create payment order." }, { status: 500 });
    }

    const checkoutResponse = await fetch(`${getMayaHost()}/checkout/v1/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(publicKey),
      },
      body: JSON.stringify({
        totalAmount: { value: product.amount, currency: "PHP" },
        requestReferenceNumber,
        items: [
          {
            name: product.title,
            quantity: 1,
            code: product.code,
            totalAmount: { value: product.amount, currency: "PHP" },
          },
        ],
        redirectUrl: {
          success: `${siteUrl}/?view=shop&maya=success&order=${order.id}`,
          failure: `${siteUrl}/?view=shop&maya=failure&order=${order.id}`,
          cancel: `${siteUrl}/?view=shop&maya=cancel&order=${order.id}`,
        },
        metadata: {
          orderId: order.id,
          userId: user.id,
          productCode: product.code,
        },
      }),
    });

    const checkout = await checkoutResponse.json().catch(() => null);
    if (!checkoutResponse.ok) {
      await admin
        .from("picklester_maya_orders")
        .update({ status: "failed", maya_response: checkout })
        .eq("id", order.id);
      return NextResponse.json(
        { error: checkout?.message || "Maya could not create the checkout." },
        { status: 502 },
      );
    }

    await admin
      .from("picklester_maya_orders")
      .update({
        maya_checkout_id: checkout?.checkoutId || checkout?.paymentId || null,
        maya_response: checkout,
        status: "pending",
      })
      .eq("id", order.id);

    return NextResponse.json({
      checkoutId: checkout?.checkoutId,
      redirectUrl: checkout?.redirectUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Maya checkout." },
      { status: 500 },
    );
  }
}
