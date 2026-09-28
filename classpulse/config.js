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

  // Demos stored on this site (folder demos/), offered to every teacher in the push list.
  //   url    = page opened on the students' phones
  //   screen = page the teacher opens on the projector (optional)
  // Each teacher adds his own links and files in the Resources tab, without touching this file.
  links: [
    { module: "IoT", label: "IoT S01 - IoT live (phones)", url: "demos/iot/s01-iot-live/", screen: "demos/iot/s01-iot-live/dashboard.html" },
    { module: "Edge & Cloud", label: "Edge & Cloud S01 - Your phones are a supercomputer", url: "demos/edge-cloud/s01-swarm/", screen: "demos/edge-cloud/s01-swarm/dashboard.html" },
    { module: "Edge & Cloud", label: "Edge & Cloud S01 - How far is the cloud?", url: "demos/edge-cloud/s01-latency/", screen: "demos/edge-cloud/s01-latency/dashboard.html" },
  ],

  // Files pushed to the phones: validity of the temporary link (hours) and maximum size (MB, 50 on the free plan).
  signedLinkHours: 4,
  maxFileMb: 50,

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
