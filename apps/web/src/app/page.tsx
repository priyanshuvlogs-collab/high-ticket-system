import { DemoChat } from "./demo-chat";

export default function HomePage() {
  return (
    <>
      <h1>Your AI appointment setter</h1>
      <p className="sub">
        Fill the form like a lead would. The agent replies in seconds, qualifies you, and books a call on the calendar.
        Text the demo number instead to see the SMS version.
      </p>
      <DemoChat />
    </>
  );
}
