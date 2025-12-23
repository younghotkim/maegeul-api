/**
 * Diary Entry serialization/deserialization for RAG pipeline
 * Validates: Requirements 4.5, 4.6
 */

export interface DiaryEntry {
  diary_id: number;
  user_id: number;
  title: string;
  content: string;
  color: string;
  date: Date;
}

export interface SerializedDiaryEntry {
  diary_id: number;
  user_id: number;
  title: string;
  content: string;
  color: string;
  date: string; // ISO 8601 format
}

/**
 * Serializes a DiaryEntry to JSON format for the RAG pipeline
 */
export function serializeDiary(diary: DiaryEntry): string {
  const serialized: SerializedDiaryEntry = {
    diary_id: diary.diary_id,
    user_id: diary.user_id,
    title: diary.title,
    content: diary.content,
    color: diary.color,
    date: diary.date.toISOString(),
  };
  return JSON.stringify(serialized);
}

/**
 * Parses a JSON string back to a DiaryEntry, validating against the schema
 */
export function parseDiary(json: string): DiaryEntry {
  const parsed = JSON.parse(json);
  
  // Validate required fields
  if (typeof parsed.diary_id !== 'number') {
    throw new Error('Invalid diary_id: must be a number');
  }
  if (typeof parsed.user_id !== 'number') {
    throw new Error('Invalid user_id: must be a number');
  }
  if (typeof parsed.title !== 'string') {
    throw new Error('Invalid title: must be a string');
  }
  if (typeof parsed.content !== 'string') {
    throw new Error('Invalid content: must be a string');
  }
  if (typeof parsed.color !== 'string') {
    throw new Error('Invalid color: must be a string');
  }
  if (typeof parsed.date !== 'string') {
    throw new Error('Invalid date: must be a string');
  }

  const date = new Date(parsed.date);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date: must be a valid ISO 8601 date string');
  }

  return {
    diary_id: parsed.diary_id,
    user_id: parsed.user_id,
    title: parsed.title,
    content: parsed.content,
    color: parsed.color,
    date: date,
  };
}

/**
 * Checks if two DiaryEntry objects are equivalent
 */
export function diaryEntriesEqual(a: DiaryEntry, b: DiaryEntry): boolean {
  return (
    a.diary_id === b.diary_id &&
    a.user_id === b.user_id &&
    a.title === b.title &&
    a.content === b.content &&
    a.color === b.color &&
    a.date.getTime() === b.date.getTime()
  );
}
