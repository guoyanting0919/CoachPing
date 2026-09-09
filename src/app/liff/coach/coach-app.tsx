"use client";

import DayView from "./day-view";
import MembersList from "./members-list";
import ScheduleForm from "./schedule-form";
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
    case "members":
      return <MembersList idToken={idToken} />;

    case "today":
      return <DayView idToken={idToken} />;

    case "schedule":
      return <ScheduleForm idToken={idToken} />;

    case "leaves":
      return <Placeholder title="請假通知" note="請假功能完成後啟用。" />;

    case "settings":
      return <Placeholder title="設定" note="開發中。" />;

    default:
      return <DayView idToken={idToken} />;
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
