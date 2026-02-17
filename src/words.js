/**
 * Auslan word registry.
 * To add a new word:
 * 1. Put the video in public/videos/
 * 2. Run extract_landmarks.py on it, save compact ref to public/data/
 * 3. Add an entry here
 */
const WORDS = [
  {
    id: "mobile_phone",
    label: "Mobile Phone",
    videoPath: "/videos/mobile_phone.mp4",
    refDataPath: "/data/mobile_phone_ref.json",
    category: "Technology",
  },
  // Add more words here as you extract them from Signbank
  // {
  //   id: "hello",
  //   label: "Hello",
  //   videoPath: "/videos/hello.mp4",
  //   refDataPath: "/data/hello_ref.json",
  //   category: "Greetings",
  // },
];

export default WORDS;
