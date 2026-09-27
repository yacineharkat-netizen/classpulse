// =============================================================================
// ClassPulse settings - the only file you normally need to edit.
// =============================================================================
const CONFIG = {
  // Supabase > Project Settings > API: "Project URL" and "anon public" key.
  // The anon key is meant to be public: it only allows calling the s_ functions.
  supabaseUrl: "https://iuhhdkirmbzmpjeyyuvp.supabase.co",
  supabaseAnonKey: "sb_publishable_aJhZsCv8Ij-A4RKC6lXfbA_bJxDoUqE",

  appName: "ClassPulse",
  institution: "USTHB · Faculty of Electrical Engineering",

  // Links the teacher can push to the students' phones (demos, documents...).
  links: [
    { label: "Demo IoT S1 - IoT live", url: "https://YOUR-GITHUB-ACCOUNT.github.io/demos/iot-live/" },
    { label: "Demo EC-S1 - latency", url: "https://YOUR-GITHUB-ACCOUNT.github.io/demos/latency/" },
  ],

  // Excel export: number of lowest quiz marks dropped when computing the average.
  dropLowest: 2,

  // How often phones re-read the state when the live channel is unavailable (ms).
  studentPollMs: 4000,
  // How often phones re-read the state even when the live channel works (ms).
  studentSafetyPollMs: 15000,
  // How often the teacher console refreshes the live figures (ms).
  teacherPollMs: 1500,
  // Teacher auto mode: seconds of correction display before the next question.
  autoNextDelayS: 8,
};
