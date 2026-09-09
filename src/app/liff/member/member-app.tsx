"use client";

import { Hint, Screen, Title } from "../ui";

export default function MemberApp({
  memberName,
  page,
}: {
  memberName: string;
  page: string | null;
}) {
  switch (page) {
    case "leave":
      return <Placeholder title="請假" note="請假功能開發中。" />;

    case "contact":
      // 學員可能同時屬於多位教練，此頁需動態列出各教練的官方帳號（SPEC.md §7）。
      return <Placeholder title="聯絡教練" note="開發中。" />;

    case "profile":
      return <Placeholder title="個人設定" note="開發中。" />;

    default:
      return (
        <Screen>
          <Title>{memberName}</Title>
          <Hint>課表查詢與請假功能開發中，完成後會出現在這裡。</Hint>
        </Screen>
      );
  }
}

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <Screen>
      <Title>{title}</Title>
      <Hint>{note}</Hint>
    </Screen>
  );
}
