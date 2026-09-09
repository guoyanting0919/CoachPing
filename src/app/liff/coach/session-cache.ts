"use client";

import { api } from "../api";
import type { SessionRow } from "./day-view";

/**
 * 課程資料的模組層級快取。
 *
 * 月曆與日期選擇器都是「開啟才掛載」的元件，若等到掛載才發請求，
 * 使用者每次展開都要盯著空白月曆等一下。改為進頁面就在背景預抓，
 * 元件掛載時直接讀快取——沒有 loading 態，因為根本不需要等。
 *
 * 存在模組層級而非 React state，才能跨元件掛載／卸載共用。
 */
const cache = new Map<string, SessionRow[]>();
const inflight = new Map<string, Promise<SessionRow[]>>();

function keyOf(from: string, to: string): string {
  return `${from}~${to}`;
}

/** 已有快取則同步取得，否則回 null。用來當作元件的初始狀態。 */
export function peekRange(from: string, to: string): SessionRow[] | null {
  return cache.get(keyOf(from, to)) ?? null;
}

/** 取得區間資料。相同區間的並行請求會共用同一個 promise。 */
export function fetchRange(
  idToken: string,
  from: string,
  to: string,
): Promise<SessionRow[]> {
  const key = keyOf(from, to);

  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = api<{ sessions: SessionRow[] }>(
    `/api/coach/sessions?from=${from}&to=${to}`,
    idToken,
  )
    .then((d) => {
      cache.set(key, d.sessions);
      return d.sessions;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** 背景預抓，不理會結果。失敗就失敗，元件掛載時會自己再抓一次。 */
export function prefetchRange(idToken: string, from: string, to: string): void {
  void fetchRange(idToken, from, to).catch(() => {});
}

const listeners = new Set<() => void>();

/** 訂閱失效事件。已掛載的元件靠這個知道自己手上的資料過期了。 */
export function subscribeInvalidate(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 課程有異動後必須清空，否則月曆會顯示舊資料。
 * 只清整份而不做細緻失效——排課異動不頻繁，重抓的成本遠低於漏更新的困惑。
 */
export function invalidateSessions(): void {
  cache.clear();
  for (const fn of listeners) fn();
}
