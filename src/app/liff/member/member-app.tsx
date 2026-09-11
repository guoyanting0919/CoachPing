"use client";

import BookSession from "./book-session";
import ContactCoaches from "./contact-coaches";
import MemberSessions from "./member-sessions";
import { Hint, Screen, Title } from "../ui";

export default function MemberApp({
  idToken,
  memberName,
  page,
}: {
  idToken: string;
  memberName: string;
  page: string | null;
}) {
  switch (page) {
    case "book":
      return <BookSession idToken={idToken} />;

    case "contact":
      return <ContactCoaches idToken={idToken} />;

    case "profile":
      return (
        <Screen>
          <Title>{memberName}</Title>
          <Hint>
            目前顯示給教練的名字是「{memberName}」。需要修改請直接跟教練說。
          </Hint>
        </Screen>
      );

    // 「我的課表」與「請假」都導到同一份清單——請假本來就是從某堂課發起的，
    // 分成兩個畫面只會讓學員多繞一次。
    default:
      return <MemberSessions idToken={idToken} />;
  }
}
