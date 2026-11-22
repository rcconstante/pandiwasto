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
  photoPath: string | null;
  visibility: "public" | "private";
}

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

/** Every learner starts with the same avatar until they pick another in Settings. */
export const DEFAULT_AVATAR: AvatarId = "chick";

export function avatarFor(value: unknown) {
  return readAvatar(value) ?? DEFAULT_AVATAR;
}

function readName(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

export function readProfile(user: User): ProfileDetails {
  const metadata = user.user_metadata;
  const candidate = typeof metadata?.photo_path === "string" ? metadata.photo_path : "";
  const [owner, filename, ...remainder] = candidate.split("/");
  return {
    displayName: readName(metadata?.display_name, 24),
    firstName: readName(metadata?.first_name, 40),
    lastName: readName(metadata?.last_name, 40),
    gender: readGender(metadata?.gender),
    avatar: avatarFor(metadata?.avatar),
    photoPath: owner === user.id && /^[a-f0-9-]{36}\.jpg$/.test(filename ?? "") && !remainder.length ? candidate : null,
    visibility: metadata?.profile_visibility === "private" ? "private" : "public",
  };
}
