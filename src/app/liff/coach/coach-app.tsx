"use client";

import InviteMember from "./invite-member";
import MembersList from "./members-list";
import { Hint, Screen, Title } from "../ui";

/** Rich Menu 各按鈕帶的 ?p= 參數對應到這裡的畫面（SPEC.md §7）。 */
export default function CoachApp({
  idToken,
  page,
}: {
  idToken: string;
  page: string | null;
}) {
  switch (page) {
    case "invite":
      return <InviteMember idToken={idToken} />;

    case "members":
      return <MembersList idToken={idToken} />;

    case "today":
      return <Placeholder title="今日課表" note="排課功能完成後啟用。" />;

    case "schedule":
      return <Placeholder title="排課" note="開發中。" />;

    case "leaves":
      return <Placeholder title="請假通知" note="請假功能完成後啟用。" />;

    case "settings":
      return <Placeholder title="設定" note="開發中。" />;

    default:
      return <MembersList idToken={idToken} />;
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
