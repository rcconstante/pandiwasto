import type { User } from "@supabase/supabase-js";

export const AVATARS = [
  { label: "Cat", id: "cat" },
  { label: "Turtle", id: "turtle" },
  { label: "Bunny", id: "bunny" },
  { label: "Chick", id: "chick" },
  { label: "Puppy", id: "puppy" },
  { label: "Panda", id: "panda" },
  { label: "Fox", id: "fox" },
  { label: "Frog", id: "frog" },
  { label: "Bear", id: "bear" },
  { label: "Owl", id: "owl" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

export const GENDER_OPTIONS = ["Girl", "Boy", "Nonbinary", "Prefer not to say"] as const;
export type ProfileGender = "" | (typeof GENDER_OPTIONS)[number];

export function readGender(value: unknown): ProfileGender {
  return GENDER_OPTIONS.find((option) => option === value) ?? "";
}

export interface ProfileDetails {
  displayName: string;
  firstName: string;
  lastName: string;
  gender: ProfileGender;
  avatar: AvatarId;
}

const LOCAL_PROFILE_KEY = "pandiwasto:local-profile";
const LEGACY_AVATARS = new Map<string, AvatarId>([
  ["pandiwasto-mascot.webp", "chick"],
  ["dashboard/games.webp", "puppy"],
  ["dashboard/lessons.webp", "owl"],
]);

export function avatarSrc(avatar: AvatarId) {
  return `${import.meta.env.BASE_URL}avatars/${avatar}.webp`;
}

export function readAvatar(value: unknown) {
  return AVATARS.find((avatar) => avatar.id === value)?.id
    ?? (typeof value === "string" ? LEGACY_AVATARS.get(value) : undefined);
}

export function randomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
}

function defaultAvatar(userId?: string) {
  if (!userId) return randomAvatar();
  let hash = 0;
  for (let index = 0; index < userId.length; index++) {
    hash = (Math.imul(hash, 31) + userId.charCodeAt(index)) >>> 0;
  }
  return AVATARS[hash % AVATARS.length].id;
}

function readName(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

export function readProfile(user?: User): ProfileDetails {
  let metadata = user?.user_metadata;
  if (!user) {
    try {
      metadata = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) ?? "null");
    } catch {
      // The local account still works when storage is unavailable.
    }
  }
  return {
    displayName: readName(metadata?.display_name, 24, user ? "" : "Sunny Maya"),
    firstName: readName(metadata?.first_name, 40),
    lastName: readName(metadata?.last_name, 40),
    gender: readGender(metadata?.gender),
    avatar: readAvatar(metadata?.avatar) ?? defaultAvatar(user?.id),
  };
}

export function saveLocalProfile(profile: ProfileDetails) {
  try {
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({
      display_name: profile.displayName,
      first_name: profile.firstName,
      last_name: profile.lastName,
      gender: profile.gender,
      avatar: profile.avatar,
    }));
  } catch {
    // The editable profile is still available for the current session.
  }
}
