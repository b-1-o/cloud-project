import type { CSSProperties, ReactElement, ReactNode } from "react";

export type FolderItem =
  | string
  | number
  | {
      id?: string;
      title?: string;
      description?: string;
      image?: string;
      alt?: string;
      content?: ReactNode;
    }
  | ReactElement;

export interface FolderProps {
  items?: FolderItem[];
  children?: ReactNode;
  mode?: "flap" | "book";
  variant?: "solid" | "glass" | "matte";
  layout?: "spread" | "stack" | "row";
  color?: string;
  paperColor?: string;
  label?: string;
  tabPosition?: "left" | "center" | "right";
  openOn?: "click" | "hover";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onItemClick?: (item: FolderItem, index: number) => void;
  onItemDrop?: (item: FolderItem, index: number, inside: boolean) => void;
  draggable?: boolean;
  zoomOnClick?: boolean;
  peek?: boolean;
  intro?: boolean;
  size?: number;
  frost?: number;
  tilt?: number;
  speed?: number;
  bounce?: number;
  closeOnOutsideClick?: boolean;
  theme?: "dark" | "light";
  className?: string;
  style?: CSSProperties;
}

declare const Folder: (props: FolderProps) => ReactElement;
export default Folder;
