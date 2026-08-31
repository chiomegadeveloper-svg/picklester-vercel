"use client";

import { useEffect, useRef, useState } from "react";
import {
  Award,
  Camera,
  CheckCircle2,
  CircleHelp,
  CircleUserRound,
  Crosshair,
  Flame,
  ImagePlus,
  LocateFixed,
  Lock,
  MapPinned,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Swords,
  Ticket,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "./lib/supabase";
import type {
  BadgeDefinition,
  NearbyPlayer,
  PlayerBadge,
  PlayerProfile,
  ProfilePhoto,
} from "./picklester-types";

type HomeFilter = "recent" | "popular" | "winners" | "find";

type FeedPost = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  author_name: string;
  author_username: string | null;
  author_avatar_url: string | null;
  author_verified: boolean;
};

type PostComment = { id:string; post_id:string; author_id:string; body:string; created_at:string; author_name:string; author_username:string|null; author_avatar_url:string|null };
type TicketRow = { id:string; subject:string; message:string; status:string; owner_reply:string|null; replied_at:string|null; created_at:string };

type ActivityItem = {
  id: string;
  event_type: "verified" | "match_win" | "mvp" | "top10";
  actor_id: string;
  actor_name: string;
  actor_username: string | null;
  actor_avatar_url: string | null;
  message: string;
  created_at: string;
  reaction_count: number;
  reacted_by_me: boolean;
  comment_count: number;
};

type ActivityComment = { id:string; activity_id:string; author_id:string; body:string; created_at:string; author_name:string; author_username:string|null; author_avatar_url:string|null };

type PlayerResult = {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  follower_count: number;
  wins_today?: number;
};

type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name: string;
  sender_username: string | null;
  sender_avatar_url: string | null;
  recipient_id?: string | null;
  recipient_name?: string | null;
};

function databaseError(message: string) {
  return message.includes("relation") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table")
    ? "Run the Picklester V15 upgrade SQL first."
    : message;
}

async function optimizeFeaturePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.58, 0.46]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.size <= 2 * 1024 * 1024) return blob;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.38));
  if (!blob) throw new Error("Conversion failed");
  return blob;
}

function PlayerImage({
  profile,
  label = "",
}: {
  profile: Pick<PlayerProfile, "avatar_url" | "name"> | null;
  label?: string;
}) {
  return profile?.avatar_url ? (
    <img src={profile.avatar_url} alt={label || profile.name} />
  ) : (
    <CircleUserRound aria-hidden="true" />
  );
}

function PickleballReactIcon() {
  return (
    <svg className="pickleball-react-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <circle cx="9" cy="7.5" r="1.25" fill="#071018" />
      <circle cx="15.5" cy="9" r="1.25" fill="#071018" />
      <circle cx="8" cy="14" r="1.25" fill="#071018" />
      <circle cx="14" cy="16.5" r="1.25" fill="#071018" />
      <circle cx="17.5" cy="13.5" r="1.1" fill="#071018" />
    </svg>
  );
}

export function SocialHomeView({
  profile,
  onOfficial,
  onProfile,
  onOpenProfile,
}: {
  profile: PlayerProfile | null;
  onOfficial: () => void;
  onProfile: () => void;
  onOpenProfile: (id: string) => void;
}) {
  const [filter, setFilter] = useState<HomeFilter>("recent");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, PostComment[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null);
  const [activityComments, setActivityComments] = useState<Record<string, ActivityComment[]>>({});
  const [activityDraft, setActivityDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHome(filter), 0);
    return () => window.clearTimeout(timer);
  }, [filter]);

  async function loadHome(next: HomeFilter, query = "") {
    setLoading(true);
    if (next === "recent") {
      const [{ data, error }, activityResult] = await Promise.all([
        supabase.rpc("list_picklester_posts", { sort_mode: "recent", result_limit: 30 }),
        supabase.rpc("list_picklester_activity_feed", { result_limit: 30 }),
      ]);
      setActivity((activityResult.data || []) as ActivityItem[]);
      if (error) {
        const fallback = await supabase.from("player_posts").select("id,author_id,body,created_at").order("created_at", { ascending: false }).limit(30);
        setPosts((fallback.data || []).map((post) => ({...post, like_count: 0, liked_by_me: false, comment_count: 0, author_name: "Picklester player", author_username: null, author_avatar_url: null, author_verified: true})) as FeedPost[]);
      } else setPosts((data || []) as FeedPost[]);
      setPlayers([]);
    } else if (next === "popular") {
      const { data, error } = await supabase.rpc("list_picklester_posts", {
        sort_mode: next,
        result_limit: 30,
      });
      if (!error) setPosts((data || []) as FeedPost[]);
      else setPosts([]);
      setActivity([]);
      setPlayers([]);
    } else if (next === "winners") {
      const { data, error } = await supabase.rpc(
        "top_picklester_winners_today",
        { result_limit: 20 },
      );
      setPlayers(error ? [] : ((data || []) as PlayerResult[]));
      setPosts([]);
      setActivity([]);
    } else {
      const { data, error } = await supabase.rpc("search_picklesters", {
        search_text: query.trim(),
        result_limit: 30,
      });
      setPlayers(error ? [] : ((data || []) as PlayerResult[]));
      setPosts([]);
    }
    setLoading(false);
  }

  async function toggleLike(postId: string) {
    const { error } = await supabase.rpc("toggle_picklester_post_like", {
      target_post: postId,
    });
    if (error) return toast.error(error.message);
    await loadHome(filter);
  }

  async function toggleComments(postId: string) {
    if (expandedPost === postId) return setExpandedPost(null);
    setExpandedPost(postId);
    const { data, error } = await supabase.rpc("list_picklester_post_comments", { target_post: postId, result_limit: 50 });
    if (error) return toast.error(databaseError(error.message));
    setComments((current) => ({...current, [postId]: (data || []) as PostComment[]}));
  }

  async function addComment(postId: string) {
    const body = (commentDraft[postId] || "").trim();
    if (!body) return;
    const { error } = await supabase.from("post_comments").insert({post_id: postId, author_id: profile?.id, body});
    if (error) return toast.error(databaseError(error.message));
    setCommentDraft((current) => ({...current, [postId]: ""}));
    setExpandedPost(null);
    await toggleComments(postId);
  }

  async function toggleActivityReaction(activityId: string) {
    const { error } = await supabase.rpc("toggle_picklester_activity_reaction", { target_activity: activityId });
    if (error) return toast.error(databaseError(error.message));
    await loadHome("recent");
  }

  async function toggleActivityComments(activityId: string) {
    if (expandedActivity === activityId) return setExpandedActivity(null);
    setExpandedActivity(activityId);
    const { data, error } = await supabase.rpc("list_picklester_activity_comments", { target_activity: activityId, result_limit: 50 });
    if (error) return toast.error(databaseError(error.message));
    setActivityComments((current) => ({ ...current, [activityId]: (data || []) as ActivityComment[] }));
  }

  async function addActivityComment(activityId: string) {
    const body = (activityDraft[activityId] || "").trim();
    if (!body) return;
    const { error } = await supabase.rpc("comment_picklester_activity", { target_activity: activityId, comment_body: body });
    if (error) return toast.error(databaseError(error.message));
    setActivityDraft((current) => ({ ...current, [activityId]: "" }));
    setExpandedActivity(null);
    await toggleActivityComments(activityId);
    await loadHome("recent");
  }

  const accessLabel =
    profile?.role === "owner"
      ? "Owner account"
      : profile?.verified
        ? "Verified player"
        : "Verification required";
  return (
    <div className="social-home-view">
      <button
        className="profile-scorecard social-home-profile"
        onClick={onProfile}
        aria-label="Open your player profile"
      >
        <div className="social-home-profile-row">
          <div className="avatar-ring social-home-avatar">
            <PlayerImage profile={profile} />
            {(profile?.verified || profile?.role === "owner") && (
              <span>
                <CheckCircle2 />
              </span>
            )}
          </div>
          <div className="social-home-copy">
            <small>PLAYER PROFILE</small>
            <h1>{profile?.name || "Your Picklester profile"}</h1>
            <p>
              {profile?.username
                ? `@${profile.username}`
                : "Complete your player details."}
            </p>
            <div>
              <b>MMR</b>
              <strong>{profile?.mmr ?? "Not rated"}</strong>
            </div>
          </div>
          <div
            className={`social-verification ${profile?.verified || profile?.role === "owner" ? "ready" : "pending"}`}
          >
            <ShieldCheck />
            <span>{accessLabel}</span>
          </div>
        </div>
      </button>

      <button className="home-official-action" onClick={onOfficial}>
        <span>
          <Crosshair />
          <b>Create Game</b>
          <small>Solo or Duo with one volunteer referee</small>
        </span>
        <Sparkles />
      </button>

      <nav className="home-floating-filters" aria-label="Home feed filters">
        <button
          className={filter === "recent" ? "active" : ""}
          onClick={() => setFilter("recent")}
        >
          <Flame />
          <span>Recent</span>
        </button>
        <button
          className={filter === "popular" ? "active" : ""}
          onClick={() => setFilter("popular")}
        >
          <Star />
          <span>Popular</span>
        </button>
        <button
          className={filter === "winners" ? "active" : ""}
          onClick={() => setFilter("winners")}
        >
          <Trophy />
          <span>Top winners</span>
        </button>
        <button
          className={filter === "find" ? "active" : ""}
          onClick={() => setFilter("find")}
        >
          <Search />
          <span>Find player</span>
        </button>
      </nav>

      <section className="home-social-panel">
        {filter === "find" && (
          <form
            className="player-search"
            onSubmit={(event) => {
              event.preventDefault();
              void loadHome("find", search);
            }}
          >
            <Search />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or username"
            />
            <button>Find</button>
          </form>
        )}
        {loading ? (
          <div className="social-empty">
            <span className="mini-loader" />
            <p>Loading live Picklester data</p>
          </div>
        ) : filter === "recent" && activity.length ? (
          <div className="activity-feed-list interactive-activity-list">{activity.map((item) => <article key={item.id} className={`activity-item ${item.event_type}`}><button className="activity-main" onClick={() => onOpenProfile(item.actor_id)}><span>{item.actor_avatar_url ? <img src={item.actor_avatar_url} alt="" /> : <CircleUserRound />}</span><p><b>{item.actor_username ? `@${item.actor_username}` : item.actor_name}</b> {item.message}</p><time>{new Date(item.created_at).toLocaleDateString()}</time></button><footer><button className={item.reacted_by_me ? "liked" : ""} onClick={() => void toggleActivityReaction(item.id)}><PickleballReactIcon /> React · {item.reaction_count || 0}</button><button className={expandedActivity === item.id ? "comments-open" : ""} onClick={() => void toggleActivityComments(item.id)}><MessageCircle /> Comment · {item.comment_count || 0}</button></footer>{expandedActivity === item.id && <div className="post-comments">{(activityComments[item.id] || []).map((comment) => <div key={comment.id}><b>@{comment.author_username || comment.author_name}</b><p>{comment.body}</p></div>)}<form onSubmit={(event) => {event.preventDefault(); void addActivityComment(item.id)}}><input value={activityDraft[item.id] || ""} onChange={(event) => setActivityDraft((current) => ({...current,[item.id]:event.target.value}))} placeholder="Write a comment" maxLength={500}/><button><Send /></button></form></div>}</article>)}</div>
        ) : filter === "recent" && !posts.length ? (
          <SocialEmpty icon={<Flame />} title="No updates yet" text="Recorded player activity will appear here automatically." />
        ) : filter === "recent" || filter === "popular" ? (
          posts.length ? (
            <div className="social-post-list">
              {posts.map((post) => (
                <article key={post.id}>
                  <button className="post-author" onClick={() => onOpenProfile(post.author_id)}><span className="post-avatar">{post.author_avatar_url ? <img src={post.author_avatar_url} alt="" /> : <CircleUserRound />}</span><span><b>{post.author_name}</b><small>{post.author_username ? `@${post.author_username}` : "Picklester player"}</small></span>{post.author_verified && <ShieldCheck />}</button>
                  <p>{post.body}</p>
                  <footer><time>{new Date(post.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</time><button className={post.liked_by_me ? "liked" : ""} onClick={() => toggleLike(post.id)}><PickleballReactIcon /> React · {post.like_count}</button><button className={expandedPost === post.id ? "comments-open" : ""} onClick={() => void toggleComments(post.id)}><MessageCircle /> Comment · {post.comment_count || 0}</button></footer>
                  {expandedPost === post.id && <div className="post-comments">{(comments[post.id] || []).map((comment) => <div key={comment.id}><b>@{comment.author_username || comment.author_name}</b><p>{comment.body}</p></div>)}<form onSubmit={(event) => {event.preventDefault(); void addComment(post.id)}}><input value={commentDraft[post.id] || ""} onChange={(event) => setCommentDraft((current) => ({...current,[post.id]:event.target.value}))} placeholder="Write a comment" maxLength={500}/><button><Send /></button></form></div>}
                </article>
              ))}
            </div>
          ) : <SocialEmpty icon={<Star />} title="No popular updates yet" text="The top 10 posts will appear here based on reactions and comments." />
        ) : players.length ? (
          <div className="player-result-list">
            {players.map((player) => (
              <button key={player.id} onClick={() => onOpenProfile(player.id)}>
                <span className="result-avatar">
                  {player.avatar_url ? (
                    <img src={player.avatar_url} alt="" />
                  ) : (
                    <CircleUserRound />
                  )}
                </span>
                <span>
                  <b>{player.name}</b>
                  <small>
                    {player.username
                      ? `@${player.username}`
                      : "Verified player"}
                  </small>
                </span>
                <em>
                  {filter === "winners"
                    ? `${player.wins_today || 0} wins today`
                    : `${player.follower_count || 0} followers`}
                </em>
              </button>
            ))}
          </div>
        ) : (
          <SocialEmpty
            icon={filter === "winners" ? <Trophy /> : <Search />}
            title={
              filter === "winners"
                ? "No winners today"
                : search
                  ? "No player found"
                  : "Find a Picklester"
            }
            text={
              filter === "winners"
                ? "Completed game results will appear automatically."
                : "Search verified players by name or username."
            }
          />
        )}
      </section>
    </div>
  );
}

function SocialEmpty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="social-empty">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export function SocialProfileView({
  viewer,
  viewedProfileId,
  onEdit,
  onSignOut,
  onMessage,
}: {
  viewer: PlayerProfile;
  viewedProfileId: string | null;
  onEdit: () => void;
  onSignOut: () => void;
  onMessage?: (username: string) => void;
}) {
  const targetId = viewedProfileId || viewer.id;
  const isOwn = targetId === viewer.id;
  const [target, setTarget] = useState<PlayerProfile>(
    isOwn ? viewer : { ...viewer, id: targetId },
  );
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [badges, setBadges] = useState<PlayerBadge[]>([]);
  const [followers, setFollowers] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [expandedPhoto, setExpandedPhoto] = useState<ProfilePhoto | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timer);
  }, [targetId, viewer]);

  async function loadProfile() {
    const profilePromise = isOwn
      ? Promise.resolve({ data: viewer, error: null })
      : supabase.from("profiles").select("*").eq("id", targetId).maybeSingle();
    const [
      profileResult,
      photoResult,
      followerResult,
      followingResult,
      badgeRows,
    ] = await Promise.all([
      profilePromise,
      supabase
        .from("profile_photos")
        .select("*")
        .eq("user_id", targetId)
        .order("slot"),
      supabase
        .from("follows")
        .select("follower_id", { count: "exact", head: true })
        .eq("following_id", targetId),
      supabase
        .from("follows")
        .select("following_id", { count: "exact", head: true })
        .eq("follower_id", targetId),
      supabase
        .from("player_badges")
        .select("badge_id,is_featured,unlocked_at")
        .eq("user_id", targetId),
    ]);
    if (profileResult.data) setTarget(profileResult.data as PlayerProfile);
    setPhotos((photoResult.data || []) as ProfilePhoto[]);
    setFollowers(followerResult.count || 0);
    setFollowingCount(followingResult.count || 0);
    const rawBadges = (badgeRows.data || []) as Array<{
      badge_id: string;
      is_featured: boolean;
      unlocked_at: string;
    }>;
    if (rawBadges.length) {
      const { data: definitions } = await supabase
        .from("badge_catalog")
        .select("*")
        .in(
          "id",
          rawBadges.map((item) => item.badge_id),
        );
      const definitionMap = new Map(
        ((definitions || []) as BadgeDefinition[]).map((badge) => [
          badge.id,
          badge,
        ]),
      );
      setBadges(
        rawBadges.flatMap((row) => {
          const badge = definitionMap.get(row.badge_id);
          return badge ? [{ ...row, badge }] : [];
        }),
      );
    } else setBadges([]);
    if (isOwn) {
      const { data: location } = await supabase
        .from("profile_locations")
        .select("location_enabled")
        .eq("user_id", viewer.id)
        .maybeSingle();
      setLocationEnabled(Boolean(location?.location_enabled));
    } else {
      const { data: followRow } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", viewer.id)
        .eq("following_id", targetId)
        .maybeSingle();
      setFollowing(Boolean(followRow));
    }
  }

  async function toggleFollow() {
    if (!viewer.verified && viewer.role === "player")
      return toast.error("Verification is required to follow players.");
    const result = following
      ? await supabase
          .from("follows")
          .delete()
          .eq("follower_id", viewer.id)
          .eq("following_id", targetId)
      : await supabase
          .from("follows")
          .insert({ follower_id: viewer.id, following_id: targetId });
    if (result.error) return toast.error(databaseError(result.error.message));
    setFollowing(!following);
    setFollowers((count) => Math.max(0, count + (following ? -1 : 1)));
  }

  async function uploadPhoto(slot: number, file: File | null) {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type))
      return toast.error("Use a JPG, PNG, or WebP photo.");
    if (file.size > 20 * 1024 * 1024)
      return toast.error("Choose a photo smaller than 20MB.");
    setUploadingSlot(slot);
    let optimized: Blob;
    try { optimized = await optimizeFeaturePhoto(file); }
    catch { setUploadingSlot(null); return toast.error("This photo could not be converted."); }
    const path = `${viewer.id}/feature-${slot}.webp`;
    const uploaded = await supabase.storage
      .from("profile-media")
      .upload(path, optimized, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
    if (uploaded.error) {
      setUploadingSlot(null);
      return toast.error(databaseError(uploaded.error.message));
    }
    const photoUrl = `${supabase.storage.from("profile-media").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
    const saved = await supabase
      .from("profile_photos")
      .upsert(
        {
          user_id: viewer.id,
          slot,
          photo_url: photoUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,slot" },
      );
    setUploadingSlot(null);
    if (saved.error) return toast.error(databaseError(saved.error.message));
    toast.success("Feature photo saved.");
    await loadProfile();
  }

  async function featureBadge(badgeId: string) {
    if (!isOwn) return;
    const { error } = await supabase.rpc("set_featured_picklester_badge", {
      target_badge: badgeId,
    });
    if (error) return toast.error(error.message);
    toast.success("Profile badge selected.");
    await loadProfile();
  }

  async function setLocationSharing(next: boolean) {
    setLocationBusy(true);
    if (!next) {
      const { error } = await supabase
        .from("profile_locations")
        .upsert(
          {
            user_id: viewer.id,
            location_enabled: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      setLocationBusy(false);
      if (error) return toast.error(databaseError(error.message));
      setLocationEnabled(false);
      return toast.success("Nearby location is off.");
    }
    if (!("geolocation" in navigator)) {
      setLocationBusy(false);
      return toast.error("Location is not available on this device.");
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { error } = await supabase
          .from("profile_locations")
          .upsert(
            {
              user_id: viewer.id,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              location_enabled: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        setLocationBusy(false);
        if (error) return toast.error(databaseError(error.message));
        setLocationEnabled(true);
        toast.success("Nearby location is on.");
      },
      () => {
        setLocationBusy(false);
        toast.error("Allow location access to appear on the nearby map.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
    );
  }

  const featuredBadge = badges.find((item) => item.is_featured);
  const badgeSlots = Array.from(
    { length: 4 },
    (_, index) => badges[index] || null,
  );
  const photoSlots = Array.from(
    { length: 4 },
    (_, index) => photos.find((photo) => photo.slot === index + 1) || null,
  );
  const isOwner = target.role === "owner";
  return (
    <div className="sports-profile-page">
      <section className="profile-dashboard-card">
        <div className="profile-identity-column">
          <div className="profile-avatar-large redesigned-avatar">
            <PlayerImage profile={target} />
            {(target.verified || isOwner) && (
              <span>
                <ShieldCheck />
              </span>
            )}
          </div>
          <h1>{target.name || "Picklester player"}</h1>
          <p>
            {target.username ? `@${target.username}` : "Username unavailable"}
          </p>
          <button className="follower-line" type="button">
            <b>{followers}</b> followers <i /> <b>{followingCount}</b> following
          </button>
          <div
            className={`verification-pending ${target.verified || isOwner ? "verified" : ""}`}
          >
            <ShieldCheck />{" "}
            {isOwner
              ? "Picklester owner account"
              : target.verified
                ? "Verified Picklester player"
                : "Waiting for owner verification"}
          </div>
          {featuredBadge && (
            <div className="featured-badge-line">
              <Award style={{ color: featuredBadge.badge.accent_color }} />
              <span>Displays {featuredBadge.badge.name}</span>
            </div>
          )}
          {isOwn ? (
            <button
              className="profile-main-action"
              type="button"
              onClick={onEdit}
            >
              Edit profile
            </button>
          ) : (
            <div className="profile-public-actions"><button
              className={`profile-main-action follow-action ${following ? "following" : ""}`}
              type="button"
              onClick={toggleFollow}
            >
              {following ? (
                <>
                  <UserMinus /> Following
                </>
              ) : (
                <>
                  <UserPlus /> Follow player
                </>
              )}
            </button><button className="profile-main-action message-action" onClick={() => target.username && onMessage?.(target.username)}><MessageCircle /> Message</button></div>
          )}
        </div>
        <div className="profile-stat-column">
          <ProfileStat
            icon={<Trophy />}
            value={target.official_wins}
            label="Official wins"
            tone="lime"
          />
          <ProfileStat
            icon={<Award />}
            value={target.mvp_records}
            label="MVP records"
            tone="orange"
          />
          <ProfileStat
            icon={<Swords />}
            value={target.official_losses}
            label="Official losses"
            tone="coral"
          />
          <ProfileStat
            icon={<ShieldCheck />}
            value={target.volunteer_referee_records}
            label="Volunteer referee"
            tone="cyan"
          />
          <ProfileStat icon={<Flame />} value={target.win_streak || 0} label="Win streak" tone="lime" />
        </div>
      </section>

      {isOwn && (
        <div className="gps-sharing-row">
          <span>
            <LocateFixed />
            <b>Nearby GPS</b>
            <small>
              Share only while you want players within 20 km to find you.
            </small>
          </span>
          <Switch
            checked={locationEnabled}
            disabled={locationBusy}
            onCheckedChange={setLocationSharing}
          />
        </div>
      )}

      <section className="profile-gallery-section">
        <header>
          <div>
            <small>FEATURE PHOTOS</small>
            <h2>Player highlights</h2>
          </div>
          <span>Tap a photo to expand</span>
        </header>
        <div className="feature-photo-grid">
          {photoSlots.map((photo, index) =>
            photo ? (
              <button key={photo.id} onClick={() => setExpandedPhoto(photo)}>
                <img
                  src={photo.photo_url}
                  alt={`${target.name} feature ${index + 1}`}
                />
              </button>
            ) : isOwn ? (
              <label key={index} className="feature-photo-upload">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    void uploadPhoto(index + 1, event.target.files?.[0] || null)
                  }
                />
                <span>
                  {uploadingSlot === index + 1 ? (
                    <span className="mini-loader" />
                  ) : (
                    <>
                      <ImagePlus />
                      <small>Photo {index + 1}</small>
                    </>
                  )}
                </span>
              </label>
            ) : (
              <div key={index} className="feature-photo-empty">
                <Camera />
              </div>
            ),
          )}
        </div>
      </section>

      <section className="profile-badges-section">
        <header>
          <div>
            <small>UNLOCKED BADGES</small>
            <h2>Choose one to display</h2>
          </div>
        </header>
        <div className="badge-slot-grid">
          {badgeSlots.map((item, index) =>
            item ? (
              <button
                key={item.badge_id}
                className={item.is_featured ? "featured" : ""}
                onClick={() => featureBadge(item.badge_id)}
                title={item.badge.description}
              >
                <span
                  style={{
                    borderColor: item.badge.accent_color,
                    color: item.badge.accent_color,
                  }}
                >
                  <Award />
                </span>
                <small>{item.badge.name}</small>
              </button>
            ) : (
              <div key={index}>
                <span>
                  <Lock />
                </span>
                <small>Locked</small>
              </div>
            ),
          )}
        </div>
      </section>

      {isOwn && (
        <button className="signout-button profile-signout" onClick={onSignOut}>
          Sign out
        </button>
      )}
      <Dialog
        open={Boolean(expandedPhoto)}
        onOpenChange={(open) => {
          if (!open) setExpandedPhoto(null);
        }}
      >
        <DialogContent className="photo-lightbox">
          <DialogHeader>
            <DialogTitle>Feature photo</DialogTitle>
            <DialogDescription>
              Tap outside or close to return to the profile.
            </DialogDescription>
          </DialogHeader>
          {expandedPhoto && (
            <button onClick={() => setExpandedPhoto(null)}>
              <img
                src={expandedPhoto.photo_url}
                alt={`${target.name} feature`}
              />
            </button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileStat({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <article className={`profile-stat ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

export function NearbyMapView({
  viewer,
  onOpenProfile,
}: {
  viewer: PlayerProfile;
  onOpenProfile: (id: string) => void;
}) {
  const [nearby, setNearby] = useState<NearbyPlayer[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNearby(), 0);
    return () => window.clearTimeout(timer);
  }, [viewer.id]);

  async function loadNearby(reacquire = false) {
    setLoading(true);
    let latitude: number | null = null;
    let longitude: number | null = null;
    const { data: stored, error: locationError } = await supabase
      .from("profile_locations")
      .select("latitude,longitude,location_enabled")
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (locationError) {
      setNearby([]);
      setEnabled(false);
      setLoading(false);
      toast.error(databaseError(locationError.message));
      return;
    }
    if (
      stored?.location_enabled &&
      stored.latitude != null &&
      stored.longitude != null &&
      !reacquire
    ) {
      latitude = Number(stored.latitude);
      longitude = Number(stored.longitude);
      setEnabled(true);
    } else if (reacquire) {
      const coords = await requestCoordinates();
      if (coords) {
        latitude = coords.latitude;
        longitude = coords.longitude;
        const { error } = await supabase
          .from("profile_locations")
          .upsert(
            {
              user_id: viewer.id,
              latitude,
              longitude,
              location_enabled: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (error) {
          setLoading(false);
          return toast.error(databaseError(error.message));
        }
        setEnabled(true);
      }
    }
    if (latitude == null || longitude == null) {
      setEnabled(false);
      setCenter(null);
      setNearby([]);
      setLoading(false);
      return;
    }
    setCenter({ latitude, longitude });
    const { data, error } = await supabase.rpc("nearby_picklesters", {
      current_lat: latitude,
      current_lng: longitude,
      radius_km: 20,
    });
    setNearby(error ? [] : ((data || []) as NearbyPlayer[]));
    setLoading(false);
  }

  async function disableLocation() {
    setLoading(true);
    const { error } = await supabase
      .from("profile_locations")
      .update({ location_enabled: false, updated_at: new Date().toISOString() })
      .eq("user_id", viewer.id);
    if (error) {
      setLoading(false);
      return toast.error(databaseError(error.message));
    }
    setEnabled(false);
    setCenter(null);
    setNearby([]);
    setLoading(false);
    toast.success("Location sharing is off.");
  }

  const mapUrl = center
    ? (() => {
        const latitudeDelta = 20 / 111.32;
        const longitudeDelta = 20 / (111.32 * Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180)));
        const bbox = [center.longitude - longitudeDelta, center.latitude - latitudeDelta, center.longitude + longitudeDelta, center.latitude + latitudeDelta].join(",");
        return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${center.latitude},${center.longitude}`)}`;
      })()
    : "";

  return (
    <div className="map-page-view">
      <div className="page-heading map-heading">
        <div>
          <small>20 KM PLAYER RADAR</small>
          <h1>Nearby Picklesters</h1>
          <p>Only verified players who turned on GPS can appear.</p>
        </div>
        <MapPinned />
      </div>
      {!enabled ? (
        <section className="map-permission-card">
          <LocateFixed />
          <h2>Your location is off</h2>
          <p>
            You control when other nearby players can discover your profile.
          </p>
          <button onClick={() => void loadNearby(true)}>
            Turn on nearby map
          </button>
        </section>
      ) : (
        <>
          <section
            className="real-nearby-map"
            aria-label="Players within 20 kilometers"
          >
            <iframe src={mapUrl} title="OpenStreetMap showing the 20 kilometer player area" loading="lazy" />
            <div className="map-radius-overlay" aria-hidden="true" />
            <span className="radar-radius">20 km radius</span>
            <div className="radar-center">
              <Crosshair />
            </div>
            {nearby.map((player) => {
              const distance = Math.min(
                20,
                Math.max(0, Number(player.distance_km)),
              );
              const radius = (distance / 20) * 43;
              const angle = ((Number(player.bearing_deg) - 90) * Math.PI) / 180;
              const left = 50 + Math.cos(angle) * radius;
              const top = 50 + Math.sin(angle) * radius;
              return (
                <button
                  key={player.id}
                  className="radar-player"
                  style={{ left: `${left}%`, top: `${top}%` }}
                  onClick={() => onOpenProfile(player.id)}
                  title={`${player.name}, ${distance.toFixed(1)} km away`}
                >
                  {player.avatar_url ? (
                    <img src={player.avatar_url} alt={player.name} />
                  ) : (
                    <CircleUserRound />
                  )}
                </button>
              );
            })}
          </section>
          <div className="map-toolbar">
            <span>
              <i /> Location sharing is on
            </span>
            <div>
              <button onClick={() => void loadNearby(true)} disabled={loading}><Crosshair /> Refresh</button>
              <button className="location-off-action" onClick={() => void disableLocation()} disabled={loading}><Lock /> Turn off</button>
            </div>
          </div>
          {loading ? (
            <div className="social-empty">
              <span className="mini-loader" />
              <p>Finding nearby players</p>
            </div>
          ) : nearby.length ? (
            <div className="nearby-list">
              {nearby.map((player) => (
                <button
                  key={player.id}
                  onClick={() => onOpenProfile(player.id)}
                >
                  <span>
                    {player.avatar_url ? (
                      <img src={player.avatar_url} alt="" />
                    ) : (
                      <CircleUserRound />
                    )}
                  </span>
                  <div>
                    <b>{player.name}</b>
                    <small>
                      {player.username
                        ? `@${player.username}`
                        : "Verified player"}
                    </small>
                  </div>
                  <em>{Number(player.distance_km).toFixed(1)} km</em>
                </button>
              ))}
            </div>
          ) : (
            <SocialEmpty
              icon={<MapPinned />}
              title="No nearby players yet"
              text="Verified players within 20 km will appear when they enable GPS."
            />
          )}
        </>
      )}
    </div>
  );
}

function requestCoordinates() {
  return new Promise<{ latitude: number; longitude: number } | null>(
    (resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        () => {
          toast.error("Allow location access to use the nearby map.");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
      );
    },
  );
}

export function ShopView() {
  const passes = [
    { name: "5-Day Pass", detail: "Unlimited games for 5 days", icon: <Swords /> },
    { name: "Weekly Pass", detail: "Unlimited games for 1 week", icon: <ShieldCheck /> },
    { name: "Monthly Pass", detail: "Unlimited games for 1 month", icon: <Trophy /> },
    { name: "Forever Pass", detail: "Unlimited games with no expiry", icon: <Sparkles /> },
  ];
  return (
    <div className="shop-page-view">
      <div className="page-heading">
        <div>
          <small>PICKLESTER MARKET</small>
          <h1>Shop</h1>
          <p>Choose an unlimited-play Game Pass. Purchasing will be connected later.</p>
        </div>
        <ShoppingBag />
      </div>
      <section className="gamepass-shop-grid">
        {passes.map((pass, index) => (
          <article key={pass.name} className={index === 3 ? "forever" : ""}>
            <div className="gamepass-product-icon">{pass.icon}</div>
            <small>GAME PASS</small>
            <h2>{pass.name}</h2>
            <p>{pass.detail}</p>
            <button disabled>Purchase setup coming soon</button>
          </article>
        ))}
      </section>
      <p className="shop-free-note">Every player receives 5 free games each day. Active Game Pass holders can play without the daily limit.</p>
    </div>
  );
}

export function ChatDock({ viewer }: { viewer: PlayerProfile }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("community");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [community, setCommunity] = useState<ChatMessage[]>([]);
  const [privateMessages, setPrivateMessages] = useState<ChatMessage[]>([]);
  const [communityDraft, setCommunityDraft] = useState("");
  const [privateUsername, setPrivateUsername] = useState("");
  const [privateDraft, setPrivateDraft] = useState("");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketBody, setTicketBody] = useState("");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let saved: { x: number; y: number } | null = null;
      try {
        saved = JSON.parse(
          localStorage.getItem("picklester.chat-position") || "null",
        );
      } catch {
        saved = null;
      }
      setPosition(
        saved || {
          x: Math.max(16, window.innerWidth - 76),
          y: Math.max(120, window.innerHeight - 170),
        },
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (open) void loadMessages(tab);
  }, [open, tab]);
  useEffect(() => {
    if (!open || tab === "gm") return;
    const timer = window.setInterval(() => void loadMessages(tab), 5000);
    return () => window.clearInterval(timer);
  }, [open, tab]);
  useEffect(() => {
    const openPrivate = (event: Event) => { setPrivateUsername((event as CustomEvent<string>).detail || ""); setTab("private"); setOpen(true); };
    window.addEventListener("picklester:message", openPrivate);
    return () => window.removeEventListener("picklester:message", openPrivate);
  }, []);

  async function loadMessages(active: string) {
    if (active === "community") {
      const { data, error } = await supabase.rpc(
        "list_picklester_community_messages",
        { message_limit: 50 },
      );
      if (error) return toast.error(databaseError(error.message));
      setCommunity((data || []) as ChatMessage[]);
    } else if (active === "private") {
      const { data, error } = await supabase.rpc(
        "list_picklester_private_messages",
        { message_limit: 50 },
      );
      if (error) return toast.error(databaseError(error.message));
      setPrivateMessages((data || []) as ChatMessage[]);
    } else if (active === "gm" && viewer.role !== "owner") {
      const { data, error } = await supabase.from("gm_tickets").select("id,subject,message,status,owner_reply,replied_at,created_at").eq("user_id", viewer.id).order("created_at", {ascending:false});
      if (error) return toast.error(databaseError(error.message));
      setTickets((data || []) as TicketRow[]);
    }
  }

  async function sendCommunity() {
    if (!communityDraft.trim()) return;
    if (!viewer.verified && viewer.role === "player")
      return toast.error("Verification is required for community chat.");
    const { error } = await supabase
      .from("community_messages")
      .insert({ sender_id: viewer.id, body: communityDraft.trim() });
    if (error) return toast.error(databaseError(error.message));
    setCommunityDraft("");
    await loadMessages("community");
  }

  async function sendPrivate() {
    if (!privateUsername.trim() || !privateDraft.trim())
      return toast.error("Enter a username and message.");
    if (!viewer.verified && viewer.role === "player")
      return toast.error("Verification is required for private chat.");
    const { data: recipient, error: findError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", privateUsername.trim().toLowerCase().replace(/^@/, ""))
      .eq("verified", true)
      .maybeSingle();
    if (findError || !recipient)
      return toast.error("Verified player not found.");
    if (recipient.id === viewer.id)
      return toast.error("Choose another player.");
    const { error } = await supabase
      .from("private_messages")
      .insert({
        sender_id: viewer.id,
        recipient_id: recipient.id,
        body: privateDraft.trim(),
      });
    if (error) return toast.error(databaseError(error.message));
    setPrivateDraft("");
    toast.success("Private message sent.");
    await loadMessages("private");
  }

  async function submitTicket() {
    if (!ticketSubject.trim() || !ticketBody.trim())
      return toast.error("Complete the ticket subject and message.");
    const { error } = await supabase
      .from("gm_tickets")
      .insert({
        user_id: viewer.id,
        subject: ticketSubject.trim(),
        message: ticketBody.trim(),
      });
    if (error) return toast.error(databaseError(error.message));
    setTicketSubject("");
    setTicketBody("");
    toast.success("Game Master ticket submitted.");
    await loadMessages("gm");
  }

  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
  }
  function pointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.current.moved = true;
    setPosition({
      x: Math.min(
        window.innerWidth - 62,
        Math.max(8, drag.current.originX + dx),
      ),
      y: Math.min(
        window.innerHeight - 72,
        Math.max(76, drag.current.originY + dy),
      ),
    });
  }
  function pointerUp() {
    const moved = drag.current?.moved;
    drag.current = null;
    try {
      localStorage.setItem(
        "picklester.chat-position",
        JSON.stringify(position),
      );
    } catch {
      /* device preference only */
    }
    if (!moved) setOpen((value) => !value);
  }

  return (
    <>
      {open && (
        <aside className="chat-popover" aria-label="Picklester chat">
          <header>
            <div>
              <MessageCircle />
              <span>
                <small>PLAYER CONNECTIONS</small>
                <b>Picklester Chat</b>
              </span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </header>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="chat-tabs">
              <TabsTrigger value="community">
                <Users /> Community
              </TabsTrigger>
              <TabsTrigger value="private">
                <MessageCircle /> Private
              </TabsTrigger>
              {viewer.role !== "owner" && <TabsTrigger value="gm"><Ticket /> My tickets</TabsTrigger>}
            </TabsList>
            <TabsContent value="community" className="chat-tab-content">
              <ChatList
                messages={community}
                viewerId={viewer.id}
                empty="No community messages yet."
              />
              <div className="chat-compose">
                <input
                  value={communityDraft}
                  onChange={(event) => setCommunityDraft(event.target.value)}
                  placeholder="Message the community"
                  maxLength={500}
                />
                <button onClick={sendCommunity}>
                  <Send />
                </button>
              </div>
            </TabsContent>
            <TabsContent value="private" className="chat-tab-content">
              <label className="chat-recipient">
                <span>To</span>
                <input
                  value={privateUsername}
                  onChange={(event) => setPrivateUsername(event.target.value)}
                  placeholder="@username"
                />
              </label>
              <ChatList
                messages={privateMessages}
                viewerId={viewer.id}
                empty="No private messages yet."
              />
              <div className="chat-compose">
                <input
                  value={privateDraft}
                  onChange={(event) => setPrivateDraft(event.target.value)}
                  placeholder="Private message"
                  maxLength={500}
                />
                <button onClick={sendPrivate}>
                  <Send />
                </button>
              </div>
            </TabsContent>
            <TabsContent value="gm" className="chat-tab-content gm-ticket-form">
              <div className="my-ticket-list">{tickets.map((ticket) => <article key={ticket.id} className={openTicketId === ticket.id ? "open" : ""}><header><b>{ticket.subject}</b><span className={`ticket-status ${ticket.status}`}>{ticket.status.replace("_", " ")}</span></header>{openTicketId === ticket.id ? <div className="ticket-conversation"><div className="ticket-user-message"><b>You</b><p>{ticket.message}</p></div>{ticket.owner_reply ? <div className="ticket-owner-message"><b>Picklester Owner</b><p>{ticket.owner_reply}</p></div> : <small>The owner will reply soon.</small>}<button className="close-ticket" onClick={() => setOpenTicketId(null)}>Close conversation</button></div> : <button className="open-ticket" onClick={() => setOpenTicketId(ticket.id)}>Open conversation</button>}</article>)}</div>
              <div className="gm-mark">
                <CircleHelp />
              </div>
              <p>Send a private concern to the Picklester Game Master.</p>
              <input
                value={ticketSubject}
                onChange={(event) => setTicketSubject(event.target.value)}
                placeholder="Ticket subject"
                maxLength={120}
              />
              <textarea
                value={ticketBody}
                onChange={(event) => setTicketBody(event.target.value)}
                placeholder="Describe your concern"
                maxLength={1200}
              />
              <button onClick={submitTicket}>
                <Ticket /> Submit ticket
              </button>
            </TabsContent>
          </Tabs>
        </aside>
      )}
      <button
        className="draggable-chat-button"
        style={{ left: position.x, top: position.y }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        aria-label="Open draggable Picklester chat"
      >
        <MessageCircle />
        <span>Chat</span>
      </button>
    </>
  );
}

function ChatList({
  messages,
  viewerId,
  empty,
}: {
  messages: ChatMessage[];
  viewerId: string;
  empty: string;
}) {
  return (
    <div className="chat-message-list">
      {messages.length ? (
        messages.map((message) => (
          <article
            key={message.id}
            className={message.sender_id === viewerId ? "mine" : ""}
          >
            <span>
              {message.sender_avatar_url ? (
                <img src={message.sender_avatar_url} alt="" />
              ) : (
                <CircleUserRound />
              )}
            </span>
            <div>
              <b>
                {message.sender_id === viewerId ? "You" : message.sender_name}
              </b>
              <p>{message.body}</p>
              <small>
                {new Date(message.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </small>
            </div>
          </article>
        ))
      ) : (
        <div className="chat-empty">
          <MessageCircle />
          <p>{empty}</p>
        </div>
      )}
    </div>
  );
}
