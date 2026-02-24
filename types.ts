export interface LevelProgress {
  completed: number;
  total: number;
  approved?: boolean;
}

export interface UserInfo {
  id: number;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  username: string;
}

export interface MemberProgress {
  user: UserInfo;
  path_name: string;
  course_id: string;
  progression: Record<string, LevelProgress>;
}

export interface ApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: MemberProgress[];
}

export interface LessonBlock {
  id: string;
  block_id: string;
  type: "sequential";
  display_name: string;
  complete?: boolean;
  block_lib_type: "imported" | "elective";
}

export interface ChapterBlock {
  id: string;
  block_id: string;
  type: "chapter";
  display_name: string;
  complete?: boolean;
  min_req_electives: number;
  children: LessonBlock[];
}

export interface CourseBlock {
  id: string;
  block_id: string;
  type: "course";
  display_name: string;
  children: ChapterBlock[];
}

export interface SpeechInfo {
  speech_title: string;
  speech_date: string;
}

export interface DetailResponse {
  blocks: CourseBlock;
  speeches: Record<string, SpeechInfo>;
}

export interface DetailRow {
  userName: string;
  pathName: string;
  level: string;
  lesson: string;
  complete: string;
  type: string;
  speechTitle: string;
  speechDate: string;
}
