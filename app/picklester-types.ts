import type { User } from "@supabase/supabase-js";

export type View = "home" | "map" | "rank" | "play" | "shop" | "profile" | "admin";

export type PlayerProfile = {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  verified: boolean;
  role: "player" | "admin" | "owner";
  mmr: number | null;
  level_name: string | null;
  official_wins: number;
  official_losses: number;
  win_streak: number;
  mvp_records: number;
  volunteer_referee_records: number;
  gamepass_expires_at: string | null;
  gamepass_forever: boolean;
  extra_game_credits: number;
  games_played_today?: number;
};

export type RankedPlayer = Pick<PlayerProfile, "id" | "name" | "username" | "avatar_url" | "mmr">;

export type ProfilePhoto = {
  id: string;
  user_id: string;
  slot: number;
  photo_url: string;
  created_at: string;
};

export type BadgeDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  accent_color: string;
  display_order: number;
};

export type PlayerBadge = {
  badge_id: string;
  is_featured: boolean;
  unlocked_at: string;
  badge: BadgeDefinition;
};

export type NearbyPlayer = Pick<PlayerProfile, "id" | "name" | "username" | "avatar_url"> & {
  distance_km: number;
  bearing_deg: number;
};

export const emptyProfile = (user: User): PlayerProfile => ({
  id: user.id,
  name: String(user.user_metadata?.name || user.user_metadata?.full_name || ""),
  username: user.user_metadata?.username ? String(user.user_metadata.username) : null,
  avatar_url: user.user_metadata?.avatar_url ? String(user.user_metadata.avatar_url) : null,
  verified: user.email?.toLowerCase() === "kuramaartsdeveloper@gmail.com",
  role: user.email?.toLowerCase() === "kuramaartsdeveloper@gmail.com" ? "owner" : "player",
  mmr: null,
  level_name: null,
  official_wins: 0,
  official_losses: 0,
  win_streak: 0,
  mvp_records: 0,
  volunteer_referee_records: 0,
  gamepass_expires_at: null,
  gamepass_forever: false,
  extra_game_credits: 0,
});
