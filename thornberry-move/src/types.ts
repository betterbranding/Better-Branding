export interface Task {
  id: number;
  title: string;
  phase: string;
  due: string | null;
  done: number;
  notes: string;
}

export interface BudgetLine {
  id: number;
  name: string;
  category: string;
  estimated: number;
  actual: number;
  paid: number;
  due: string | null;
}

export interface Item {
  id: number;
  name: string;
  room: string;
  qty: number;
  cost: number;
  bought: number;
  priority: string;
}

export interface PriceOffer {
  store: string;
  price: number | null;
  url: string;
  name?: string;
  note?: string;
}

export interface Furniture {
  id: number;
  name: string;
  room: string;
  url: string;
  image_path: string;
  qty: number;
  price: number;
  price_low: number | null;
  price_high: number | null;
  store: string;
  notes: string;
  ai_summary: string;
  offers: PriceOffer[];
  bought: number;
  created_at?: string;
}

export type TableName = 'tasks' | 'budget' | 'items' | 'furniture';

export interface AppState {
  settings: Record<string, string>;
  tasks: Task[];
  budget: BudgetLine[];
  items: Item[];
  furniture: Furniture[];
}

export interface Actions {
  create: (table: TableName, row: object) => void;
  update: (table: TableName, id: number, patch: object) => void;
  remove: (table: TableName, id: number) => void;
  setSetting: (key: string, value: string) => void;
}

export type Tab = 'checklist' | 'budget' | 'items' | 'furniture';

export const PHASES = ['4+ weeks out', '2–3 weeks out', 'Final week', 'Moving day', 'After the move'];
export const BUDGET_CATEGORIES = ['Moving', 'Home', 'Utilities', 'Furniture & Decor', 'Other'];
export const ROOMS = [
  'Kitchen',
  'Bathrooms',
  'Bedrooms',
  'Living Room',
  'Dining Room',
  'Office',
  'Garage & Utility',
  'Safety',
  'Cleaning',
  'Outdoor',
];

export const FURNITURE_ROOMS = [
  'Living Room',
  'Dining Room',
  'Kitchen',
  'Primary Bedroom',
  'Bedrooms',
  'Office',
  'Bathrooms',
  'Entry',
  'Outdoor',
  'Garage & Utility',
];
