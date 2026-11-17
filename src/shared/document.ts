export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ShotEasing = "linear" | "easeInOut" | "easeOut" | "hold";
export type ShotTransition = "pan" | "cut";
export interface ShotKeyframe {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PanelShot {
  /** 起始取景框（页面坐标系） */
  start: ShotKeyframe;
  /** 结束取景框 */
  end: ShotKeyframe;
  /** 起点停留秒数 */
  holdIn: number;
  /** 终点停留秒数 */
  holdOut: number;
  /** 与下一格的衔接：连续移动 pan / 切镜 cut */
  transition: ShotTransition;
  easing: ShotEasing;
  /** 速度系数，越大移动越快；与揭示顺序冲突时用于权衡 */
  motionScale: number;
  /** 安全可见区内缩像素，镜头取景框不得越过收缩后的安全区 */
  safePadding: number;
  /** 作者指定的替代路径中间点（绕开未揭示对白区） */
  alternatePath: ShotKeyframe[];
  /** 对白在本段镜头进度中的揭示时刻 0..1 */
  dialogueAt: number;
  /** 声音在本段镜头进度中的触发时刻 0..1 */
  soundAt: number;
  /** 布局变更后待修订：时间线在此格形成明确边界 */
  stale?: boolean;
}
export interface Panel {
  id: string;
  rect: Rect;
  dialogue: string;
  speaker: string;
  sound: "rain" | "pulse" | "wind";
  duration: number;
  shot?: PanelShot;
}
export interface ComicPage {
  id: string;
  title: string;
  image: string;
  width: number;
  height: number;
  panels: Panel[];
  /** 作者约束的安全可见区域，预演取景框必须始终落在其中 */
  safeArea?: Rect;
}
export interface Chapter {
  id: string;
  title: string;
  subtitle: string;
  pages: ComicPage[];
}
export interface ComicDocument {
  version: 1;
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
}
export interface ReadingLocation {
  chapterId: string;
  pageId: string;
  panelId: string;
  zoom: number;
  x: number;
  y: number;
}
export interface Bookmark {
  id: string;
  label: string;
  location: ReadingLocation;
  created: number;
}
export type ReadingMode = "page" | "panel" | "director";
