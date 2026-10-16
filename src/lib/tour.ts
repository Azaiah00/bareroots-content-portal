import type { Role } from "@shared/types";

/**
 * The guided walkthrough. Each step points at a route and (optionally) an
 * element tagged data-tour="<id>"; the Tour component navigates there,
 * scrolls it into view, spotlights it and shows the card.
 */

export interface TourStep {
  route: string;
  target?: string;
  title: string;
  body: string;
}

export const CLIENT_TOUR: TourStep[] = [
  {
    route: "drop",
    title: "Welcome to your content house",
    body: "This is where Bare Roots and Couture House meet. You drop off raw footage here; finished posts come back here with captions and posting times. Takes two minutes to learn — let's walk through it.",
  },
  {
    route: "drop",
    target: "drop-note",
    title: "Say what the footage is",
    body: "One line is plenty — \"Sabrina's retightening, Tuesday\" or \"DOPE HAIR product shots\". It tells the studio what they're looking at. Optional, but it helps.",
  },
  {
    route: "drop",
    target: "drop-zone",
    title: "Tap, choose, done",
    body: "Tap here to open your camera roll and pick as many photos and videos as you like. Big files are fine. You'll see a progress bar for each one and \"Received\" when it lands.",
  },
  {
    route: "drop",
    target: "drop-history",
    title: "Everything you've sent",
    body: "Every drop-off stays listed here with thumbnails, so you always know what went through. \"Used in content\" means the studio has cut something from it. You can delete a file or a whole drop-off any time.",
  },
  {
    route: "ready",
    target: "ready-stats",
    title: "Your posts, ready",
    body: "Finished videos and graphics land here. \"Need your OK\" counts the ones waiting for a look from you.",
  },
  {
    route: "ready",
    target: "ready-grid",
    title: "Open a post",
    body: "Tap a card to open it. Inside: a big Download button, Copy caption, Copy hashtags, the recommended day and time for Instagram and TikTok, and a Posted tick for each. Then tap Approve — or Request a change (one round is included, five business days, then it's approved automatically).",
  },
  {
    route: "calendar",
    target: "cal-week",
    title: "Your week",
    body: "Every scheduled post for the next seven days, in order. Tick Posted as you go — the studio sees it too, so nobody has to ask.",
  },
  {
    route: "ideas",
    target: "ideas-pin",
    title: "Pin an idea",
    body: "Saw a trend? A question clients keep asking? Something you want filmed? Pin it. Fred and Azaiah reply right on the note, and can turn it into content with one tap.",
  },
  {
    route: "activity",
    target: "activity-feed",
    title: "What's new",
    body: "Every drop-off, delivery, approval and reply, newest first. The badge on the tab tells you when something's waiting. No emails to dig through.",
  },
  {
    route: "activity",
    title: "That's the whole thing",
    body: "Drop off raw. Pick up finished. Post it. Tap the Guide button any time to see this again — and if anything's confusing, pin it on the Ideas board and we'll sort it.",
  },
];

export const STUDIO_TOUR: TourStep[] = [
  {
    route: "footage",
    title: "The studio side",
    body: "Same link as the client, different view. You see everything they drop off, publish finished work back to them, and keep the calendar and ideas board in sync. Quick lap around.",
  },
  {
    route: "footage",
    target: "footage-storage",
    title: "Storage meter",
    body: "Backblaze's free tier is 10 GB. Raw video eats it fast, so once a clip has been cut, Archive it — the originals are deleted and the record stays. Download anything you still want first.",
  },
  {
    route: "footage",
    target: "footage-batches",
    title: "Drop-offs",
    body: "Each client drop is a group with thumbnails. Tap a tile to select, then Download, Mark used, Archive or Delete from the bar that appears. Tap the play icon on a tile to preview it in place.",
  },
  {
    route: "ready",
    target: "ready-new",
    title: "New content",
    body: "This opens the composer: upload the finished file and a cover, write the caption and hashtags, set a posting time per platform (Suggest times fills in best slots), link the raw footage it came from, then Publish. Until you publish, it's a draft only you can see.",
  },
  {
    route: "ready",
    target: "ready-stats",
    title: "Quota at a glance",
    body: "Videos and statics delivered this month against the Essentials package (3 video posts a week, 15 statics a month). \"Changes\" shows anything the client has sent back.",
  },
  {
    route: "ready",
    target: "ready-grid",
    title: "Delivered work",
    body: "Open a card to see its status, who approved it, and any change request. Edit reopens the composer; after a fix, Deliver the fix restarts the five-business-day clock.",
  },
  {
    route: "calendar",
    target: "cal-month",
    title: "Posting calendar",
    body: "Every platform plan with a date. Gold badge = scheduled, filled badge = posted. Dates come from each piece's posting plan in the composer.",
  },
  {
    route: "ideas",
    target: "ideas-board",
    title: "Ideas board",
    body: "Reply, heart, set a status, pin to top — and Make this content turns a note straight into a draft with the idea in your studio notes.",
  },
  {
    route: "activity",
    target: "activity-feed",
    title: "Activity",
    body: "Drop-offs, approvals, change requests, replies. Tap any line to jump to the thing it's about. Check the badge each morning and you'll never miss a drop.",
  },
  {
    route: "activity",
    title: "Done",
    body: "Tap Guide any time to replay this. The client's walkthrough is different — sign in with their PIN once to see what they see.",
  },
];

export const tourFor = (role: Role): TourStep[] => (role === "studio" ? STUDIO_TOUR : CLIENT_TOUR);

export const TOUR_SEEN_KEY = (role: Role) => `br-tour-seen-${role}`;
