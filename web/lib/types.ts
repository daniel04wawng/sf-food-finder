export type EventSource =
  | "Luma"
  | "Cerebral Valley"
  | "X"
  | "Eventbrite"
  | "Meetup"
  | "Partiful";

export interface FoodEvent {
  id: string;
  source: EventSource;
  title: string;
  venue: string;
  lat: number;
  lng: number;
  start: string;
  end: string;
  url: string;
  foodTypes: string[];
  keywords: string[];
  description: string;
}
