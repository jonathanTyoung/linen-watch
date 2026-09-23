import { cookies } from "next/headers";
import { PEOPLE, type Person } from "./catalog";

export const USER_COOKIE = "lw_user";

/**
 * Stand-in for auth while this runs on local dev: a cookie that says whether
 * Nick or Jake is at the keyboard, so approvals are attributed to someone.
 * Swap for Clerk/Supabase auth before this is deployed anywhere.
 */
export async function currentUser(): Promise<Person> {
  const value = (await cookies()).get(USER_COOKIE)?.value;
  return value && value in PEOPLE ? (value as Person) : "nick";
}
