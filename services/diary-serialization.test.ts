import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  DiaryEntry,
  serializeDiary,
  parseDiary,
  diaryEntriesEqual,
} from './diary-serialization';

/**
 * **Feature: mudita-bot, Property 12: Diary Serialization Round Trip**
 * **Validates: Requirements 4.5, 4.6**
 * 
 * *For any* Diary_Entry, serializing to JSON and parsing back SHALL produce 
 * an equivalent object with all fields preserved.
 */

// Arbitrary generator for valid dates (ensuring no NaN dates)
const validDateArbitrary = fc.integer({
  min: new Date('2000-01-01T00:00:00.000Z').getTime(),
  max: new Date('2100-12-31T23:59:59.999Z').getTime(),
}).map(timestamp => new Date(timestamp));

// Arbitrary generator for valid DiaryEntry objects
const diaryEntryArbitrary: fc.Arbitrary<DiaryEntry> = fc.record({
  diary_id: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  user_id: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  title: fc.string({ minLength: 0, maxLength: 255 }),
  content: fc.string({ minLength: 0, maxLength: 10000 }),
  color: fc.constantFrom('red', 'yellow', 'blue', 'green', '#FF0000', '#FFFF00', '#0000FF', '#00FF00'),
  date: validDateArbitrary,
});

describe('Diary Serialization Round Trip', () => {
  /**
   * **Feature: mudita-bot, Property 12: Diary Serialization Round Trip**
   * **Validates: Requirements 4.5, 4.6**
   */
  it('should preserve all fields when serializing and parsing a diary entry', () => {
    fc.assert(
      fc.property(diaryEntryArbitrary, (diary: DiaryEntry) => {
        // Serialize to JSON
        const serialized = serializeDiary(diary);
        
        // Parse back from JSON
        const parsed = parseDiary(serialized);
        
        // Verify all fields are preserved
        return diaryEntriesEqual(diary, parsed);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 12: Diary Serialization Round Trip**
   * **Validates: Requirements 4.5, 4.6**
   * 
   * Additional property: serialized output should be valid JSON
   */
  it('should produce valid JSON when serializing', () => {
    fc.assert(
      fc.property(diaryEntryArbitrary, (diary: DiaryEntry) => {
        const serialized = serializeDiary(diary);
        
        // Should not throw when parsing as JSON
        expect(() => JSON.parse(serialized)).not.toThrow();
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 12: Diary Serialization Round Trip**
   * **Validates: Requirements 4.5, 4.6**
   * 
   * Additional property: date should be preserved with millisecond precision
   */
  it('should preserve date with millisecond precision', () => {
    fc.assert(
      fc.property(diaryEntryArbitrary, (diary: DiaryEntry) => {
        const serialized = serializeDiary(diary);
        const parsed = parseDiary(serialized);
        
        // Date timestamps should match exactly
        return diary.date.getTime() === parsed.date.getTime();
      }),
      { numRuns: 100 }
    );
  });
});
