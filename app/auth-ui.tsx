"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Camera,
  CircleUserRound,
  ImagePlus,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  getKeepMeLoggedIn,
  setKeepMeLoggedIn,
  supabase,
} from "./lib/supabase";
import type { PlayerProfile } from "./picklester-types";
import { InstallPicklester } from "./install-picklester";

type AuthMode = "register" | "signin";

export function AuthView() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  const preview = useMemo(
    () => (avatar ? URL.createObjectURL(avatar) : null),
    [avatar],
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(() => {
    setKeepLoggedIn(getKeepMeLoggedIn());
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().toLowerCase();
    if (mode === "register" && (!name.trim() || !cleanUsername || !avatar))
      return toast.error("Name, username and profile photo are required.");
    if (mode === "register" && !/^[a-z0-9_]{3,24}$/.test(cleanUsername))
      return toast.error(
        "Username must be 3–24 characters using letters, numbers or underscore.",
      );
    setBusy(true);
    try {
      if (mode === "signin") {
        setKeepMeLoggedIn(keepLoggedIn);
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error?.message.toLowerCase().includes("email not confirmed"))
          setPendingConfirmationEmail(cleanEmail);
        if (error) throw error;
      } else {
        const availability = await supabase.rpc(
          "is_picklester_username_available",
          { candidate: cleanUsername },
        );
        if (!availability.error && availability.data === false)
          throw new Error("That username is already taken.");
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/?registration=confirmed`,
            data: { name: name.trim(), username: cleanUsername },
          },
        });
        if (error) throw error;
        if (
          data.user &&
          data.user.identities &&
          data.user.identities.length === 0
        )
          throw new Error(
            "This email already has an account. Choose Sign in instead.",
          );
        if (data.session)
          await persistRegistrationProfile(
            data.session.user,
            name,
            username,
            avatar,
          );
        if (!data.session) {
          if (avatar) await storePendingAvatar(cleanEmail, avatar);
          setPendingConfirmationEmail(cleanEmail);
          toast.success(
            "Registration received. Open the confirmation email from Supabase, then sign in.",
          );
          setMode("signin");
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to continue.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function social() {
    setKeepMeLoggedIn(keepLoggedIn);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "https://www.picklester.asia" },
    });
    if (error) toast.error(error.message);
  }

  async function resendConfirmation() {
    if (!pendingConfirmationEmail) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingConfirmationEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/?registration=confirmed`,
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("A new confirmation email was sent.");
  }

  return (
    <div className="phone-app auth-page">
      <section className="auth-brand">
        <img src="/picklester-logo.png" alt="Picklester" />
        <small>VERIFIED PICKLEBALL COMMUNITY</small>
        <h1>
          {mode === "register" ? "Create your player profile" : "Welcome back"}
        </h1>
        <p>
          {mode === "register"
            ? "Register first. Owner verification unlocks games, chat and player features."
            : "Sign in to continue to your Picklester profile."}
        </p>
      </section>
      <form className="auth-card" onSubmit={submit}>
        {pendingConfirmationEmail && (
          <div className="confirmation-callout">
            <Mail />
            <span>
              <b>Confirm your Gmail registration</b>
              <small>
                We sent a link to {pendingConfirmationEmail}. Check Inbox and
                Spam.
              </small>
            </span>
            <button type="button" onClick={resendConfirmation} disabled={busy}>
              Resend
            </button>
          </div>
        )}
        <button className="google-primary" type="button" onClick={social}>
          <b>G</b>
          <span>Continue with Google</span>
        </button>
        {mode === "signin" && (
          <label className="keep-login-option">
            <input
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(event) => setKeepLoggedIn(event.target.checked)}
            />
            <span aria-hidden="true">{keepLoggedIn ? "✓" : ""}</span>
            <div>
              <b>Keep me logged in</b>
              <small>Stay signed in on this device</small>
            </div>
          </label>
        )}
        <div className="auth-divider">
          <span>
            {mode === "register"
              ? "or register with email"
              : "or sign in with email"}
          </span>
        </div>
        {mode === "register" && (
          <>
            <label className="avatar-upload auth-avatar">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setAvatar(event.target.files?.[0] || null)}
              />
              {preview ? (
                <img src={preview} alt="Selected profile preview" />
              ) : (
                <CircleUserRound />
              )}
              <span>
                <Camera /> Add photo
              </span>
            </label>
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your complete name"
                autoComplete="name"
              />
            </label>
            <label>
              <span>Username</span>
              <input
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value.replace(/\s/g, ""))
                }
                placeholder="picklestername"
                autoCapitalize="none"
              />
            </label>
          </>
        )}
        <label>
          <span>Email</span>
          <div className="input-with-icon">
            <Mail />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
        </label>
        <label>
          <span>Password</span>
          <div className="input-with-icon">
            <LockKeyhole />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              minLength={6}
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              required
            />
          </div>
        </label>
        <button className="auth-primary" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" />
          ) : mode === "register" ? (
            "Create account"
          ) : (
            "Sign in"
          )}
        </button>
        {mode === "register" && <InstallPicklester compact />}
        <button
          className="auth-switch"
          type="button"
          onClick={() => {
            setMode(mode === "register" ? "signin" : "register");
            setPendingConfirmationEmail("");
          }}
        >
          {mode === "register"
            ? "Already registered? Sign in"
            : "New player? Register first"}
        </button>
      </form>
    </div>
  );
}

export function CompleteProfile({
  user,
  profile,
  onSaved,
  onSignOut,
}: {
  user: User;
  profile: PlayerProfile;
  onSaved: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="phone-app auth-page complete-profile-page">
      <section className="auth-brand">
        <img src="/picklester-logo.png" alt="Picklester" />
        <small>ONE LAST STEP</small>
        <h1>Complete your profile</h1>
        <p>Add your player name and username before requesting verification.</p>
      </section>
      <ProfileForm user={user} profile={profile} onSaved={onSaved} />
      <button className="text-button" onClick={onSignOut}>
        <LogOut /> Sign out
      </button>
    </div>
  );
}

export function ProfileForm({
  user,
  profile,
  onSaved,
  close,
}: {
  user: User;
  profile: PlayerProfile;
  onSaved: () => void;
  close?: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [username, setUsername] = useState(profile.username || "");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(
    () => (avatar ? URL.createObjectURL(avatar) : profile.avatar_url),
    [avatar, profile.avatar_url],
  );

  useEffect(
    () => () => {
      if (avatar && preview) URL.revokeObjectURL(preview);
    },
    [avatar, preview],
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !username.trim())
      return toast.error("Name and username are required.");
    setBusy(true);
    try {
      let avatarUrl = profile.avatar_url;
      if (avatar) avatarUrl = await uploadAvatar(user, avatar);
      const cleanUsername = username.trim().toLowerCase();
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          name: name.trim(),
          username: cleanUsername,
          avatar_url: avatarUrl,
        },
      });
      if (authError) throw authError;
      await saveProfileRow(user.id, name.trim(), cleanUsername, avatarUrl);
      toast.success("Profile updated.");
      onSaved();
      close?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card profile-form" onSubmit={save}>
      <label className="avatar-upload profile-form-avatar">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setAvatar(event.target.files?.[0] || null)}
        />
        {preview ? (
          <img src={preview} alt="Player avatar preview" />
        ) : (
          <CircleUserRound />
        )}
        <span>
          <ImagePlus /> Change photo
        </span>
      </label>
      <label>
        <span>Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your complete name"
        />
      </label>
      <label>
        <span>Username</span>
        <input
          value={username}
          onChange={(event) =>
            setUsername(event.target.value.replace(/\s/g, ""))
          }
          placeholder="picklestername"
          autoCapitalize="none"
        />
      </label>
      <button className="auth-primary" disabled={busy}>
        {busy ? (
          <Loader2 className="spin" />
        ) : (
          <>
            <Save /> Save profile
          </>
        )}
      </button>
    </form>
  );
}

async function uploadAvatar(user: User, file: File) {
  if (file.size > 3 * 1024 * 1024)
    throw new Error("Profile photo must be 3MB or smaller.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/avatar.${extension}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
}

async function persistRegistrationProfile(
  user: User,
  name: string,
  username: string,
  avatar: File | null,
) {
  const avatarUrl = avatar
    ? await uploadAvatar(user, avatar)
    : user.user_metadata?.avatar_url || null;
  const cleanUsername = username.trim().toLowerCase();
  const cleanName = name.trim();
  const { error: authError } = await supabase.auth.updateUser({
    data: { name: cleanName, username: cleanUsername, avatar_url: avatarUrl },
  });
  if (authError) throw authError;
  await saveProfileRow(user.id, cleanName, cleanUsername, avatarUrl);
}

async function saveProfileRow(
  userId: string,
  name: string,
  username: string,
  avatarUrl: string | null,
) {
  const values = {
    name,
    username,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString(),
  };
  const updated = await supabase
    .from("profiles")
    .update(values)
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) {
    const inserted = await supabase
      .from("profiles")
      .insert({ id: userId, ...values });
    if (inserted.error) throw inserted.error;
  }
}

async function storePendingAvatar(email: string, file: File) {
  if (file.size > 3 * 1024 * 1024) return;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    localStorage.setItem(
      "picklester.pending-avatar",
      JSON.stringify({
        email: email.toLowerCase(),
        name: file.name,
        type: file.type,
        dataUrl,
      }),
    );
  } catch {
    // The selected image remains available through normal profile editing.
  }
}

export async function restorePendingRegistrationAvatar(user: User) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem("picklester.pending-avatar");
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as {
      email: string;
      name: string;
      type: string;
      dataUrl: string;
    };
    if (pending.email !== user.email?.toLowerCase()) return null;
    const blob = await fetch(pending.dataUrl).then((response) =>
      response.blob(),
    );
    const file = new File([blob], pending.name, { type: pending.type });
    const avatarUrl = await uploadAvatar(user, file);
    await supabase.auth.updateUser({
      data: { ...user.user_metadata, avatar_url: avatarUrl },
    });
    localStorage.removeItem("picklester.pending-avatar");
    return avatarUrl;
  } catch {
    return null;
  }
}
