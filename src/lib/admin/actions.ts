"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "../prisma";
import { inviteUrl } from "../auth";
import { login, logout, requireAdmin } from "./session";

/**
 * 管理後台的 Server Action（SPEC.md §16）。
 *
 * 每個 action 第一行都 await requireAdmin()。理由：'use server' 編譯後每個 action
 * 都是一個公開的 POST 端點（Next.js 文件：「the route is reachable to anyone who can
 * send the same POST. Treat every action as an untrusted entry point.」）。
 * proxy.ts 的 matcher 只是碰巧擋得住——action 從別的路徑被 import 就漏了。
 */

const COACH_INVITE_TTL_DAYS = 14;

const inviteSchema = z.object({
  label: z.string().trim().min(1, "請填教練名稱").max(50),
  days: z.coerce.number().int().min(1).max(90).default(COACH_INVITE_TTL_DAYS),
});

export type InviteResult =
  | { ok: true; url: string; label: string }
  | { ok: false; error: string };

export async function createCoachInvite(
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  await requireAdmin();

  const parsed = inviteSchema.safeParse({
    label: formData.get("label"),
    days: formData.get("days") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "輸入有誤" };
  }

  const { label, days } = parsed.data;
  const invite = await prisma.coachInvite.create({
    data: {
      label,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    },
    select: { token: true },
  });

  revalidatePath("/admin/coaches");
  return { ok: true, url: inviteUrl(invite.token), label };
}

export type LoginResult = { error: string } | null;

export async function loginAction(
  _prev: LoginResult,
  formData: FormData,
): Promise<LoginResult> {
  const password = formData.get("password");
  if (typeof password !== "string" || !(await login(password))) {
    return { error: "密碼錯誤" };
  }
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/admin/login");
}
