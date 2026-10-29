import type {
  GrammarLevelDefinition,
  GrammarObject,
  Verse,
  Word,
} from "@bibleol/contracts";

export interface GrammarObjectItem {
  kind: "object";
  object: GrammarObject;
  color: string | null;
  depth: number;
}

export interface GrammarWordsItem {
  kind: "words";
  words: Word[];
  depth: number;
}

export type GrammarItem = GrammarObjectItem | GrammarWordsItem;

export interface VerseGrammar {
  verse: Verse;
  items: GrammarItem[];
}

interface WordGroup {
  monad: number;
  word: Word;
}

interface ChildGroup {
  monad: number;
  object: GrammarObject;
}

function spanLength(object: GrammarObject): number {
  return object.lastMonad - object.firstMonad;
}

function sortObjects(left: GrammarObject, right: GrammarObject): number {
  return (
    left.firstMonad - right.firstMonad ||
    spanLength(right) - spanLength(left) ||
    left.depth - right.depth
  );
}

function containsMonad(object: GrammarObject, monad: number): boolean {
  return object.firstMonad <= monad && monad <= object.lastMonad;
}

/**
 * Organise the flat grammar objects of a chapter into a readable structure for
 * every verse. Each word is attached to the deepest grammatical object that
 * contains it, and objects are rendered in reading order with their children.
 */
export function buildGrammarByVerse(
  verses: Verse[],
  objects: GrammarObject[],
  levels: GrammarLevelDefinition[],
): VerseGrammar[] {
  const colors = new Map(levels.map((level) => [level.key, level.color]));

  return verses.map((verse) => {
    const words = verse.words;
    if (words.length === 0) {
      return { verse, items: [] };
    }

    const firstMonad = words[0]!.monad;
    const lastMonad = words[words.length - 1]!.monad;
    const relevant = objects.filter(
      (object) =>
        object.lastMonad >= firstMonad && object.firstMonad <= lastMonad,
    );
    const byId = new Map(relevant.map((object) => [object.id, object]));
    const children = new Map<string, GrammarObject[]>();
    const roots: GrammarObject[] = [];

    for (const object of relevant) {
      const parent = object.parentId ? byId.get(object.parentId) : undefined;
      if (parent) {
        const bucket = children.get(parent.id);
        if (bucket) {
          bucket.push(object);
        } else {
          children.set(parent.id, [object]);
        }
      } else {
        roots.push(object);
      }
    }
    roots.sort(sortObjects);
    for (const bucket of children.values()) {
      bucket.sort(sortObjects);
    }

    const wordsByObject = new Map<string, Word[]>();
    const unassigned: Word[] = [];
    for (const word of words) {
      let owner: GrammarObject | undefined;
      for (const object of relevant) {
        if (!containsMonad(object, word.monad)) {
          continue;
        }
        if (
          !owner ||
          object.depth > owner.depth ||
          (object.depth === owner.depth &&
            spanLength(object) < spanLength(owner))
        ) {
          owner = object;
        }
      }
      if (!owner) {
        unassigned.push(word);
        continue;
      }
      const bucket = wordsByObject.get(owner.id);
      if (bucket) {
        bucket.push(word);
      } else {
        wordsByObject.set(owner.id, [word]);
      }
    }

    const items: GrammarItem[] = [];
    const pushWords = (group: Word[], depth: number): void => {
      if (group.length === 0) {
        return;
      }
      items.push({ kind: "words", words: group, depth });
    };

    pushWords(unassigned, 0);

    const walk = (object: GrammarObject): void => {
      items.push({
        kind: "object",
        object,
        color: colors.get(object.level) ?? null,
        depth: object.depth,
      });

      const content: Array<ChildGroup | WordGroup> = [];
      for (const word of wordsByObject.get(object.id) ?? []) {
        content.push({ monad: word.monad, word });
      }
      for (const child of children.get(object.id) ?? []) {
        content.push({ monad: child.firstMonad, object: child });
      }
      content.sort((left, right) => left.monad - right.monad);

      let buffer: Word[] = [];
      const flush = (): void => {
        pushWords(buffer, object.depth + 1);
        buffer = [];
      };
      for (const entry of content) {
        if ("word" in entry) {
          buffer.push(entry.word);
        } else {
          flush();
          walk(entry.object);
        }
      }
      flush();
    };

    for (const root of roots) {
      walk(root);
    }

    return { verse, items };
  });
}
