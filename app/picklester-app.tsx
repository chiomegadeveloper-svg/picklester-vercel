"use client";

import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  Bell,
  ChevronRight,
  CircleUserRound,
  Home,
  Loader2,
  QrCode,
  Radio,
  ScanLine,
  ShieldCheck,
  ShoppingBag as ShopIcon,
  MapPinned as MapIcon,
  Swords,
  Ticket,
  Trophy,
  UserCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";
import {
  AuthView,
  CompleteProfile,
  ProfileForm,
  restorePendingRegistrationAvatar,
} from "./auth-ui";
import { supabase } from "./lib/supabase";
import {
  emptyProfile,
  type PlayerProfile,
  type RankedPlayer,
  type View,
} from "./picklester-types";
import {
  ChatDock,
  NearbyMapView,
  ShopView,
  SocialHomeView,
  SocialProfileView,
} from "./picklester-social";
import { PicklesterMatchDialog } from "./picklester-match";
import type { MatchResult } from "./picklester-match";
import { InstallPicklester } from "./install-picklester";

export function PicklesterApp({
  initialView = "home",
}: {
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [showSplash, setShowSplash] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authStartupNotice, setAuthStartupNotice] = useState<string | null>(
    null,
  );
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [topPlayers, setTopPlayers] = useState<RankedPlayer[]>([]);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [nearbyRanks, setNearbyRanks] = useState<Array<RankedPlayer & { rank: number }>>([]);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchMode, setMatchMode] = useState<"create" | "scan">("scan");
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const soundPlayed = useRef(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => registration.update())
        .catch(() => undefined);
    }
    const syncViewFromUrl = () => {
      if (window.location.pathname === "/profile") {
        setViewedProfileId(
          new URLSearchParams(window.location.search).get("id"),
        );
        return setView("profile");
      }
      const requested = new URLSearchParams(window.location.search).get("view");
      setViewedProfileId(null);
      setView(
        requested === "map" ||
          requested === "rank" ||
          requested === "play" ||
          requested === "shop" ||
          requested === "admin"
          ? requested
          : "home",
      );
    };
    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    const timer = window.setTimeout(() => setShowSplash(false), 4000);

    let active = true;
    const authSafetyTimer = window.setTimeout(() => {
      if (!active) return;
      setAuthStartupNotice(
        "Session recovery took too long. You can sign in again safely.",
      );
      setAuthLoading(false);
    }, 5000);
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error)
          setAuthStartupNotice(
            "Your saved session could not be restored. Please sign in again.",
          );
        setSession(data.session);
      })
      .catch(() => {
        if (active)
          setAuthStartupNotice(
            "Your saved session could not be restored. Please sign in again.",
          );
      })
      .finally(() => {
        if (!active) return;
        window.clearTimeout(authSafetyTimer);
        setAuthLoading(false);
      });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!active) return;
        window.clearTimeout(authSafetyTimer);
        setSession(nextSession);
        if (!nextSession) {
          setProfile(null);
          setTopPlayers([]);
          setCurrentRank(null);
        }
        setAuthStartupNotice(null);
        setAuthLoading(false);
      },
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(authSafetyTimer);
      window.removeEventListener("popstate", syncViewFromUrl);
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    void loadPlayerData(session.user);
  }, [session?.user]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !("geolocation" in navigator)) return;

    let active = true;
    const heartbeat = async () => {
      if (!active || document.visibilityState === "hidden") return;
      const { data } = await supabase
        .from("profile_locations")
        .select("location_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      if (!active || !data?.location_enabled) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!active) return;
          void supabase.from("profile_locations").upsert(
            {
              user_id: userId,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              location_enabled: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        },
        () => undefined,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 45000 },
      );
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 60000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session?.user?.id]);

  async function loadPlayerData(user: User) {
    const fallback = emptyProfile(user);
    const restoredAvatar = await restorePendingRegistrationAvatar(user);
    if (restoredAvatar) fallback.avatar_url = restoredAvatar;
    let { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (!error && !data) {
      const created = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          name: fallback.name,
          username: fallback.username,
          avatar_url: fallback.avatar_url,
        })
        .select("*")
        .single();
      data = created.data;
      error = created.error;
    }
    if (!error && data && restoredAvatar) {
      const updated = await supabase
        .from("profiles")
        .update({
          avatar_url: restoredAvatar,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .select("*")
        .single();
      if (!updated.error) data = updated.data;
    }
    const loaded =
      error || !data ? fallback : ({ ...fallback, ...data } as PlayerProfile);
    if (user.email?.toLowerCase() === "kuramaartsdeveloper@gmail.com") {
      loaded.role = "owner";
      loaded.verified = true;
    }
    setProfile(loaded);

    const { data: leaders } = await supabase
      .from("profiles")
      .select("id,name,username,avatar_url,mmr")
      .eq("verified", true)
      .not("mmr", "is", null)
      .order("mmr", { ascending: false })
      .limit(10);
    setTopPlayers((leaders || []) as RankedPlayer[]);

    if (loaded.verified && loaded.mmr !== null) {
      const [{ count: higherCount }, { count: rankedCount }] = await Promise.all([
        supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("verified", true)
        .gt("mmr", loaded.mmr),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("verified", true)
          .not("mmr", "is", null),
      ]);
      const rank = (higherCount ?? 0) + 1;
      const total = rankedCount ?? rank;
      const start = Math.min(Math.max(0, rank - 6), Math.max(0, total - 10));
      const { data: neighbors } = await supabase
        .from("profiles")
        .select("id,name,username,avatar_url,mmr")
        .eq("verified", true)
        .not("mmr", "is", null)
        .order("mmr", { ascending: false })
        .range(start, start + 9);
      setCurrentRank(rank);
      setNearbyRanks(((neighbors || []) as RankedPlayer[]).map((player, index) => ({ ...player, rank: start + index + 1 })));
    } else {
      setCurrentRank(null);
      setNearbyRanks([]);
    }
  }

  function navigate(next: View, profileId: string | null = null) {
    if (
      next === "admin" &&
      profile?.role !== "owner" &&
      profile?.role !== "admin"
    ) {
      toast.error("Owner access is required.");
      return;
    }
    const nextUrl =
      next === "profile"
        ? profileId
          ? `/profile?id=${encodeURIComponent(profileId)}`
          : "/profile"
        : next === "home"
          ? "/"
          : `/?view=${next}`;
    window.history.pushState({}, "", nextUrl);
    setViewedProfileId(next === "profile" ? profileId : null);
    setView(next);
  }

  function requireVerified(action: () => void) {
    if (!session?.user) return;
    const currentRole = profile?.role || "player";
    const hasAccess = Boolean(profile?.verified || currentRole === "owner" || currentRole === "admin");
    if (!hasAccess)
      return toast.error(
        "Owner verification is required before creating or joining a game.",
      );
    action();
  }

  function openMatch(mode: "create" | "scan") {
    setMatchMode(mode);
    setMatchOpen(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  if (showSplash)
    return (
      <SplashScreen onImpact={() => void playPaddleHit(soundPlayed)} />
    );
  if (authLoading)
    return (
      <main className="arena-shell">
        <div className="auth-loading">
          <Loader2 className="spin" />
          <span>Loading Picklester</span>
        </div>
      </main>
    );
  if (!session)
    return (
      <main className="arena-shell">
        <Toaster richColors position="top-center" />
        {authStartupNotice && (
          <div className="auth-startup-notice" role="status">
            {authStartupNotice}
          </div>
        )}
        <AuthView />
      </main>
    );
  if (profile && (!profile.name || !profile.username || !profile.avatar_url)) {
    return (
      <main className="arena-shell">
        <Toaster richColors position="top-center" />
        <CompleteProfile
          user={session.user}
          profile={profile}
          onSaved={() => loadPlayerData(session.user)}
          onSignOut={signOut}
        />
      </main>
    );
  }

  return (
    <main className="arena-shell">
      <Toaster richColors position="top-center" />
      <div className="phone-app">
        <header className="app-header">
          <button
            className="brand-lockup"
            onClick={() => navigate("home")}
            aria-label="Go to home"
          >
            <img
              className="official-logo"
              src="/picklester-logo-transparent.png"
              alt="Picklester"
            />
          </button>
          {profile && (
            <button
              className="subscription-status"
              onClick={() => navigate("shop")}
              aria-label="Open game pass shop"
              title="Open game pass shop"
            >
              <span>
                {profile.role === "owner" || profile.role === "admin"
                  ? "STAFF FOREVER PASS"
                  : profile.gamepass_forever
                  ? "FOREVER PASS"
                  : profile.gamepass_expires_at &&
                      new Date(profile.gamepass_expires_at) > new Date()
                    ? "GAME PASS ACTIVE"
                    : "FREE PLAN"}
              </span>
              <strong>
                {profile.role === "owner" || profile.role === "admin"
                  ? "Unlimited Games"
                  : profile.gamepass_forever
                  ? "Unlimited Games"
                  : profile.gamepass_expires_at &&
                      new Date(profile.gamepass_expires_at) > new Date()
                    ? `Until ${new Date(profile.gamepass_expires_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`
                    : profile.extra_game_credits > 0
                      ? `5 Daily + ${profile.extra_game_credits} Extra`
                      : "5 Games Daily"}
              </strong>
            </button>
          )}
          <div className="header-actions">
            {(profile?.role === "owner" || profile?.role === "admin") && (
              <button
                className="icon-button control-center-header"
                onClick={() => navigate("admin")}
                aria-label="Open owner control center"
              >
                <ShieldCheck size={18} />
              </button>
            )}
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button
              className="mini-avatar"
              onClick={() => navigate("profile")}
              aria-label="Open profile"
            >
              <Avatar profile={profile} />
            </button>
          </div>
        </header>

        <section
          className={`app-content ${view === "home" ? "home-content" : ""}`}
          aria-live="polite"
        >
          {view === "home" && (
            <SocialHomeView
              profile={profile}
              onOfficial={() => void requireVerified(() => openMatch("create"))}
              onProfile={() => navigate("profile")}
              onOpenProfile={(id) => navigate("profile", id)}
            />
          )}
          {view === "map" && profile && (
            <NearbyMapView
              viewer={profile}
              onOpenProfile={(id) => navigate("profile", id)}
            />
          )}
          {view === "rank" && (
            <RankView
              players={topPlayers}
              profile={profile}
              currentRank={currentRank}
              nearbyRanks={nearbyRanks}
              onPlayer={(id) => navigate("profile", id)}
            />
          )}
          {view === "play" && (
            <PlayView
              verified={Boolean(
                profile?.verified ||
                profile?.role === "owner" ||
                profile?.role === "admin",
              )}
              onCreate={() => void requireVerified(() => openMatch("create"))}
              onScan={() => void requireVerified(() => openMatch("scan"))}
            />
          )}
          {view === "shop" && profile && session && (
            <ShopView viewer={profile} onPurchaseActivated={() => loadPlayerData(session.user)} />
          )}
          {view === "profile" && profile && (
            <>
              <SocialProfileView
                viewer={profile}
                viewedProfileId={viewedProfileId}
                onEdit={() => setEditProfileOpen(true)}
                onSignOut={signOut}
                onMessage={(username) => window.dispatchEvent(new CustomEvent("picklester:message", {detail: username}))}
              />
              <div className="profile-install-row">
                <InstallPicklester />
              </div>
            </>
          )}
          {view === "admin" && (
            <AdminView currentRole={profile?.role || "player"} />
          )}
        </section>

        <nav className="bottom-nav" aria-label="Primary navigation">
          <NavButton
            icon={<Home />}
            label="Home"
            active={view === "home"}
            onClick={() => navigate("home")}
          />
          <NavButton
            icon={<MapIcon />}
            label="Map"
            active={view === "map"}
            onClick={() => void requireVerified(() => navigate("map"))}
          />
          <NavButton
            icon={<Trophy />}
            label="Top 10"
            active={view === "rank"}
            onClick={() => navigate("rank")}
          />
          <button
            className="scan-action"
            onClick={() => void requireVerified(() => openMatch("scan"))}
            aria-label="Scan a game QR"
          >
            <ScanLine />
            <span>Scan</span>
          </button>
          <NavButton
            icon={<Radio />}
            label="Play"
            active={view === "play"}
            onClick={() => navigate("play")}
          />
          <NavButton
            icon={<ShopIcon />}
            label="Shop"
            active={view === "shop"}
            onClick={() => navigate("shop")}
          />
          <NavButton
            icon={<CircleUserRound />}
            label="Profile"
            active={view === "profile" || view === "admin"}
            onClick={() => navigate("profile")}
          />
        </nav>
      </div>
      {profile && (
        <PicklesterMatchDialog
          open={matchOpen}
          initialMode={matchMode}
          viewer={profile}
          onOpenChange={setMatchOpen}
          onOpenShop={() => navigate("shop")}
          onResult={(result) => {
            setMatchResult(result);
            void loadPlayerData(session.user);
            window.dispatchEvent(new CustomEvent("picklester:activity"));
          }}
        />
      )}
      <Dialog
        open={Boolean(matchResult)}
        onOpenChange={(next) => {
          if (!next) setMatchResult(null);
        }}
      >
        <DialogContent
          className={`match-dialog match-result-dialog ${matchResult?.won ? "winner" : "loser"}`}
        >
          <div className="result-trophy">
            <Trophy />
          </div>
          <DialogHeader>
            <DialogTitle>
              {matchResult?.role === "referee"
                ? "Result recorded!"
                : matchResult?.won
                  ? "Congratulations!"
                  : "Nice Game!"}
            </DialogTitle>
            <DialogDescription>
              {matchResult?.score} final score
            </DialogDescription>
          </DialogHeader>
          {matchResult?.role === "player" ? (
            <>
              <strong className="result-mmr">
                {(matchResult.mmrDelta || 0) > 0 ? "+" : ""}
                {matchResult.mmrDelta} MMR
              </strong>
              {matchResult.isMvp && (
                <div className="mvp-celebration">
                  <Trophy />
                  <b>MVP</b>
                  <span>Includes +3 MMR MVP bonus</span>
                </div>
              )}
            </>
          ) : (
            <p className="referee-result-note">
              Your volunteer referee record was updated.
            </p>
          )}
          <button
            className="dialog-primary"
            onClick={() => setMatchResult(null)}
          >
            Continue
          </button>
        </DialogContent>
      </Dialog>
      {profile && (
        <EditProfileDialog
          open={editProfileOpen}
          onOpenChange={setEditProfileOpen}
          user={session.user}
          profile={profile}
          onSaved={() => loadPlayerData(session.user)}
        />
      )}
      {profile && <ChatDock viewer={profile} />}
    </main>
  );
}

function SplashScreen({ onImpact }: { onImpact: () => void }) {
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  const logo = useRef<HTMLImageElement>(null);

  function startSplash() {
    if (started.current) return;
    started.current = true;
    setReady(true);
    // Match the sound to the expanding impact ring instead of playing before
    // the logo has decoded. If autoplay is blocked, it is intentionally silent
    // rather than replaying late on an unrelated tap.
    window.setTimeout(onImpact, 180);
  }

  useEffect(() => {
    // A cached image can finish before React attaches its onLoad handler.
    // Start explicitly in that case so the splash never remains transparent.
    if (logo.current?.complete) startSplash();
  }, []);

  return (
    <main
      className={`splash-screen${ready ? " is-ready" : ""}`}
      aria-label="Picklester is loading"
    >
      <div className="splash-impact">
        <span className="impact-ring" />
        <img
          ref={logo}
          src="/picklester-logo-transparent.png"
          alt="Picklester"
          width="512"
          height="512"
          decoding="async"
          onLoad={startSplash}
        />
      </div>
      <div className="splash-loader">
        <span />
        <span />
        <span />
      </div>
      <small>PLAY · PROVE · RANK</small>
    </main>
  );
}

async function playPaddleHit(played: React.MutableRefObject<boolean>) {
  if (played.current || typeof window === "undefined") return;
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    await context.resume();
    if (context.state !== "running") return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(140, now + 0.085);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.11);
    played.current = true;
    window.setTimeout(() => void context.close(), 180);
  } catch {
    // The first touch retries playback when browser autoplay is unavailable.
  }
}

function Avatar({ profile }: { profile: PlayerProfile | null }) {
  return profile?.avatar_url ? (
    <img src={profile.avatar_url} alt="" />
  ) : (
    <CircleUserRound />
  );
}

function RankView({
  players,
  profile,
  currentRank,
  nearbyRanks,
  onPlayer,
}: {
  players: RankedPlayer[];
  profile: PlayerProfile | null;
  currentRank: number | null;
  nearbyRanks: Array<RankedPlayer & { rank: number }>;
  onPlayer: (id: string) => void;
}) {
  return (
    <div className="view-stack page-view">
      <div className="page-heading">
        <div>
          <small>RECORDED MMR</small>
          <h1>Top 10</h1>
          <p>Completed Picklester games update the leaderboard.</p>
        </div>
        <Trophy />
      </div>
      {players.length ? (
        <section className="real-leaderboard">
          {players.map((player, index) => (
            <button
              type="button"
              key={player.id}
              className={player.id === profile?.id ? "is-current" : ""}
              onClick={() => onPlayer(player.id)}
            >
              <strong>{index + 1}</strong>
              <div className="rank-avatar">
                {player.avatar_url ? (
                  <img src={player.avatar_url} alt="" />
                ) : (
                  <CircleUserRound />
                )}
              </div>
              <span>
                <b>{player.name}</b>
                <small>
                  {player.username ? `@${player.username}` : "Verified player"}
                </small>
              </span>
              <em>{player.mmr}</em>
            </button>
          ))}
        </section>
      ) : (
        <section className="empty-state leaderboard-empty">
          <div>
            <Trophy />
          </div>
          <h2>No ranked players yet</h2>
          <p>
            The Top 10 will populate automatically from recorded game results.
          </p>
        </section>
      )}
      <SectionTitle title="Current rank" />
      <section className="current-rank-card">
        <div className="player-avatar tone-blue">
          <Avatar profile={profile} />
        </div>
        <div>
          <b>{profile?.name || "Current player"}</b>
          <span>
            {profile?.verified
              ? "Your current leaderboard position."
              : "Complete verification and play a recorded game."}
          </span>
        </div>
        <strong>{currentRank ? `#${currentRank}` : "Unranked"}</strong>
      </section>
      {nearbyRanks.length > 0 && (
        <>
          <SectionTitle title="Your nearest ranks" />
          <section className="real-leaderboard nearby-rank-list">
            {nearbyRanks.map((player) => (
              <button
                type="button"
                key={player.id}
                className={player.id === profile?.id ? "is-current" : ""}
                onClick={() => onPlayer(player.id)}
              >
                <strong>{player.rank}</strong>
                <div className="rank-avatar">
                  {player.avatar_url ? <img src={player.avatar_url} alt="" /> : <CircleUserRound />}
                </div>
                <span><b>{player.name}</b><small>{player.username ? `@${player.username}` : "Verified player"}</small></span>
                <em>{player.mmr}</em>
              </button>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function PlayView({
  verified,
  onCreate,
  onScan,
}: {
  verified: boolean;
  onCreate: () => void;
  onScan: () => void;
}) {
  return (
    <div className="view-stack page-view">
      <div className="page-heading">
        <div>
          <small>GAME CENTER</small>
          <h1>Play</h1>
          <p>
            {verified
              ? "Create one recorded game or scan the creator’s QR to join."
              : "Owner verification is required to use player features."}
          </p>
        </div>
        <Swords />
      </div>
      <button className="official-banner" onClick={onCreate}>
        <div className="scan-graphic">
          <QrCode />
        </div>
        <span>
          <small>ONE CREATOR</small>
          <b>Create Game</b>
          <p>Choose Solo or Duo and display one QR.</p>
        </span>
        <ChevronRight />
      </button>
      <button className="official-banner scan-join-banner" onClick={onScan}>
        <div className="scan-graphic">
          <ScanLine />
        </div>
        <span>
          <small>JOIN EVENT</small>
          <b>Scan Creator QR</b>
          <p>Join as a player or volunteer referee.</p>
        </span>
        <ChevronRight />
      </button>
      <section className="empty-state play-simple-state">
        <div>
          <ShieldCheck />
        </div>
        <h2>Every game is recorded</h2>
        <p>
          Solo requires 2 players and 1 referee. Duo requires 4 players and 1
          referee.
        </p>
      </section>
    </div>
  );
}

function AdminView({ currentRole }: { currentRole: PlayerProfile["role"] }) {
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [tickets, setTickets] = useState<Array<{id:string;user_id:string;subject:string;message:string;status:string;owner_reply:string|null;created_at:string;user_name:string;user_username:string|null}>>([]);
  const [purchaseLogs, setPurchaseLogs] = useState<Array<{id:string;user_id:string;pass_type:string;amount:number|null;payment_reference:string|null;created_at:string;user_name:string;user_username:string|null}>>([]);
  const [purchaseForm, setPurchaseForm] = useState({ userId: "", passType: "5", amount: "", reference: "" });
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [ticketPage, setTicketPage] = useState(1);

  async function loadPlayers() {
    setLoading(true);
    setAdminError(null);
    let { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      const fallback = await supabase.rpc("list_picklester_control_center");
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      setAdminError("Control Center database access needs the latest Picklester SQL update.");
      toast.error(error.message);
    }
    setPlayers((data || []) as PlayerProfile[]);
    if (currentRole === "owner") {
      const { data: ticketRows, error: ticketError } = await supabase.rpc("list_picklester_owner_tickets");
      if (ticketError) toast.error(ticketError.message);
      else setTickets((ticketRows || []) as typeof tickets);
      const { data: logRows, error: logError } = await supabase.rpc("list_picklester_gamepass_purchases");
      if (!logError) setPurchaseLogs((logRows || []) as typeof purchaseLogs);
    }
    setLoading(false);
  }

  async function replyToTicket(ticketId: string, status: "in_progress" | "resolved") {
    const reply = (ticketReplies[ticketId] || "").trim();
    if (!reply) return toast.error("Write your reply first.");
    const { error } = await supabase.rpc("reply_picklester_ticket", {
      target_ticket: ticketId,
      reply_text: reply,
      next_status: status,
    });
    if (error) return toast.error(error.message);
    setTicketReplies((current) => ({ ...current, [ticketId]: "" }));
    toast.success(status === "resolved" ? "Ticket answered and resolved." : "Reply sent.");
    await loadPlayers();
  }

  async function deleteTicket(ticketId: string) {
    if (!window.confirm("Delete this ticket permanently?")) return;
    const { error } = await supabase.rpc("delete_picklester_ticket", { target_ticket: ticketId });
    if (error) return toast.error(error.message);
    setOpenTicketId(null); toast.success("Ticket deleted."); await loadPlayers();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPlayers(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function verify(playerId: string) {
    const { error } = await supabase.rpc("set_picklester_verification", {
      target_user: playerId,
      approved: true,
    });
    if (error) return toast.error(error.message);
    toast.success("Player verified.");
    await loadPlayers();
  }

  async function changeRole(playerId: string, role: "player" | "admin") {
    const { error } = await supabase.rpc("set_picklester_role", {
      target_user: playerId,
      new_role: role,
    });
    if (error) return toast.error(error.message);
    toast.success(
      role === "admin"
        ? "Member promoted to admin."
        : "Admin returned to player role.",
    );
    await loadPlayers();
  }

  async function activateGamepass(playerId: string, passDays: 0 | 5 | 7 | 30) {
    const { error } = await supabase.rpc("activate_picklester_gamepass", { target_user: playerId, pass_days: passDays });
    if (error) return toast.error(error.message);
    toast.success(`Game Pass activated for ${passDays === 0 ? "Forever" : passDays === 30 ? "1 month" : passDays === 7 ? "1 week" : "5 days"}.`);
    await loadPlayers();
  }

  async function recordGamepassPurchase() {
    if (!purchaseForm.userId) return toast.error("Choose a player first.");
    const passDays = Number(purchaseForm.passType) as 0 | 5 | 7 | 30;
    const { error } = await supabase.rpc("record_picklester_gamepass_purchase", {
      target_user: purchaseForm.userId,
      pass_days: passDays,
      paid_amount: purchaseForm.amount ? Number(purchaseForm.amount) : null,
      payment_ref: purchaseForm.reference.trim() || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Purchase logged and Game Pass activated.");
    setPurchaseForm({ userId: "", passType: "5", amount: "", reference: "" });
    await loadPlayers();
  }

  const pending = players.filter(
    (player) => player.role === "player" && !player.verified,
  );
  const verified = players.filter((player) => player.verified).length;
  const ticketPageSize = 5;
  const ticketPages = Math.max(1, Math.ceil(tickets.length / ticketPageSize));
  const visibleTickets = tickets.slice((ticketPage - 1) * ticketPageSize, ticketPage * ticketPageSize);
  return (
    <div className="view-stack page-view">
      <div className="page-heading admin-heading">
        <div>
          <small>OWNER ONLY</small>
          <h1>Control Center</h1>
          <p>Review members and protect recorded results.</p>
        </div>
        <ShieldCheck />
      </div>
      <section className="admin-stats">
        <article>
          <span>Pending</span>
          <b>{loading ? "…" : pending.length}</b>
        </article>
        <article>
          <span>Verified</span>
          <b>{loading ? "…" : verified}</b>
        </article>
        <article>
          <span>Players</span>
          <b>{loading ? "…" : players.length}</b>
        </article>
      </section>
      {adminError && <section className="admin-access-error"><ShieldCheck /><div><b>Control Center could not load</b><p>{adminError}</p></div><button onClick={() => void loadPlayers()}>Retry</button></section>}
      {currentRole === "owner" && (
        <>
          <SectionTitle title="Tickets received" />
          <section className="owner-ticket-list">
            {tickets.length ? visibleTickets.map((ticket) => (
              <article key={ticket.id} className={openTicketId === ticket.id ? "open" : ""}>
                <header><div><b>{ticket.subject}</b><small>@{ticket.user_username || ticket.user_name}</small></div><span className={`ticket-status ${ticket.status}`}>{ticket.status.replace("_", " ")}</span></header>
                {openTicketId !== ticket.id ? <button className="open-ticket" onClick={() => setOpenTicketId(ticket.id)}>Open conversation</button> : <><div className="ticket-conversation"><div className="ticket-user-message"><b>{ticket.user_name}</b><p>{ticket.message}</p></div>{ticket.owner_reply && <div className="ticket-owner-message"><b>You · Owner</b><p>{ticket.owner_reply}</p></div>}</div><textarea value={ticketReplies[ticket.id] || ""} onChange={(event) => setTicketReplies((current) => ({...current, [ticket.id]: event.target.value}))} placeholder="Reply to this player" maxLength={1200} /><div><button onClick={() => void replyToTicket(ticket.id, "in_progress")}>Send reply</button><button className="resolve-ticket" onClick={() => void replyToTicket(ticket.id, "resolved")}>Reply & resolve</button><button className="delete-ticket" onClick={() => void deleteTicket(ticket.id)}>Delete</button><button className="close-ticket" onClick={() => setOpenTicketId(null)}>Close</button></div></>}
              </article>
            )) : <div className="empty-state admin-empty"><Ticket /><h2>No tickets received</h2><p>Player support tickets will appear here.</p></div>}
          </section>
          {tickets.length > ticketPageSize && <nav className="ticket-pagination"><button disabled={ticketPage === 1} onClick={() => setTicketPage((page) => page - 1)}>Previous</button><span>{ticketPage} / {ticketPages}</span><button disabled={ticketPage === ticketPages} onClick={() => setTicketPage((page) => page + 1)}>Next</button></nav>}
        </>
      )}
      <SectionTitle title="Pending verification" />
      {loading ? (
        <section className="empty-state admin-empty">
          <Loader2 className="spin" />
          <h2>Loading applications</h2>
        </section>
      ) : pending.length ? (
        <section className="pending-list real-pending-list">
          {pending.map((player) => (
            <article key={player.id}>
              <div className="pending-avatar">
                <Avatar profile={player} />
              </div>
              <div>
                <b>{player.name || "Incomplete profile"}</b>
                <span>
                  {player.username ? `@${player.username}` : "No username"}
                </span>
              </div>
              <button onClick={() => verify(player.id)}>
                <UserCheck /> Verify
              </button>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state admin-empty">
          <div>
            <UserCheck />
          </div>
          <h2>No pending applications</h2>
          <p>New verification requests will appear here.</p>
        </section>
      )}
      {currentRole === "owner" && (
        <>
          <SectionTitle title="Game Pass purchases" />
          <section className="gamepass-purchase-panel">
            <div className="gamepass-purchase-form">
              <select value={purchaseForm.userId} onChange={(event) => setPurchaseForm((current) => ({...current, userId:event.target.value}))}>
                <option value="">Select player</option>
                {players.filter((player) => player.role !== "owner").map((player) => <option key={player.id} value={player.id}>{player.name} {player.username ? `@${player.username}` : ""}</option>)}
              </select>
              <select value={purchaseForm.passType} onChange={(event) => setPurchaseForm((current) => ({...current, passType:event.target.value}))}>
                <option value="5">5 days</option><option value="7">1 week</option><option value="30">1 month</option><option value="0">Forever</option>
              </select>
              <input type="number" min="0" step="0.01" placeholder="Amount paid (optional)" value={purchaseForm.amount} onChange={(event) => setPurchaseForm((current) => ({...current, amount:event.target.value}))} />
              <input maxLength={100} placeholder="Payment reference (optional)" value={purchaseForm.reference} onChange={(event) => setPurchaseForm((current) => ({...current, reference:event.target.value}))} />
              <button onClick={() => void recordGamepassPurchase()}>Save purchase & activate</button>
            </div>
            <div className="gamepass-purchase-log">
              {purchaseLogs.length ? purchaseLogs.slice(0, 10).map((log) => <article key={log.id}><div><b>{log.user_name}</b><small>@{log.user_username || "player"} · {log.pass_type}</small></div><span>{log.amount == null ? "Granted" : `₱${Number(log.amount).toLocaleString()}`}<small>{new Date(log.created_at).toLocaleDateString()}</small></span></article>) : <p>No Game Pass purchases logged yet.</p>}
            </div>
          </section>
          <SectionTitle title="Member roles" />
          <section className="pending-list real-pending-list role-list">
            {players
              .filter(
                (player) =>
                  player.role !== "owner" &&
                  (player.verified || player.role === "admin"),
              )
              .map((player) => (
                <article key={player.id}>
                  <div className="pending-avatar">
                    <Avatar profile={player} />
                  </div>
                  <div>
                    <b>{player.name || "Member"}</b>
                    <span>
                      {player.role === "admin"
                        ? "Administrator"
                        : player.username
                          ? `@${player.username}`
                          : "Verified player"}
                    </span>
                  </div>
                  <button
                    className={player.role === "admin" ? "demote-action" : ""}
                    onClick={() =>
                      changeRole(
                        player.id,
                        player.role === "admin" ? "player" : "admin",
                      )
                    }
                  >
                    {player.role === "admin" ? "Remove admin" : "Promote admin"}
                  </button>
                  <div className="gamepass-controls">
                    <div className="gamepass-label"><b>Grant Game Pass</b><small>{player.gamepass_forever ? "Forever Pass active" : player.gamepass_expires_at && new Date(player.gamepass_expires_at) > new Date() ? `Active until ${new Date(player.gamepass_expires_at).toLocaleDateString()}` : "No Game Pass · 5 free games daily"}</small></div>
                    <button onClick={() => void activateGamepass(player.id, 5)}>5 days</button>
                    <button onClick={() => void activateGamepass(player.id, 7)}>1 week</button>
                    <button onClick={() => void activateGamepass(player.id, 30)}>1 month</button>
                    <button onClick={() => void activateGamepass(player.id, 0)}>Forever</button>
                  </div>
                </article>
              ))}
          </section>
        </>
      )}
      <SectionTitle title="Ranking safeguards" />
      <section className="settings-card">
        <div>
          <span>
            <b>Every game is recorded</b>
            <small>
              Each created event has one creator and one pairing record.
            </small>
          </span>
          <ShieldCheck />
        </div>
        <div>
          <span>
            <b>One volunteer referee</b>
            <small>Solo needs 3 users; Duo needs 5 users.</small>
          </span>
          <ShieldCheck />
        </div>
        <div>
          <span>
            <b>Creator QR pairing</b>
            <small>All other participants scan the creator’s QR.</small>
          </span>
          <QrCode />
        </div>
      </section>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <span>{icon}</span>
      <small>{label}</small>
    </button>
  );
}
function SectionTitle({ title }: { title: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
    </div>
  );
}

function EditProfileDialog({
  open,
  onOpenChange,
  user,
  profile,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  profile: PlayerProfile;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="match-dialog edit-profile-dialog">
        <DialogHeader>
          <div className="dialog-kicker">
            <CircleUserRound /> PLAYER PROFILE
          </div>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update your public player name, username and photo.
          </DialogDescription>
        </DialogHeader>
        <ProfileForm
          user={user}
          profile={profile}
          onSaved={onSaved}
          close={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
