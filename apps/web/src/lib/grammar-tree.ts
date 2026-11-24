import type {
  GrammarLevelDefinition,
  GrammarObject,
  Verse,
  Word,
} from "@aletheia-codex/contracts";

export interface GrammarObjectNode {
  kind: "object";
  object: GrammarObject;
  color: string | null;
  depth: number;
  children: GrammarTreeNode[];
}

export interface GrammarWordsNode {
  kind: "words";
  words: Word[];
}

export type GrammarTreeNode = GrammarObjectNode | GrammarWordsNode;

export interface VerseGrammar {
  verse: Verse;
  items: GrammarTreeNode[];
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
 * Organise the flat grammar objects of a chapter into a nested tree for every
 * verse. Each object node contains its direct content (words and child objects)
 * in reading order, so the UI can render nested boxes matching the legacy
 * structure (oración contains cláusulas, cláusulas contain frases, etc.).
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

    const items: GrammarTreeNode[] = [];
    if (unassigned.length > 0) {
      items.push({ kind: "words", words: unassigned });
    }

    const walk = (object: GrammarObject): GrammarObjectNode => {
      const content: Array<ChildGroup | WordGroup> = [];
      for (const word of wordsByObject.get(object.id) ?? []) {
        content.push({ monad: word.monad, word });
      }
      for (const child of children.get(object.id) ?? []) {
        content.push({ monad: child.firstMonad, object: child });
      }
      content.sort((left, right) => left.monad - right.monad);

      const nodeChildren: GrammarTreeNode[] = [];
      let buffer: Word[] = [];
      const flush = (): void => {
        if (buffer.length > 0) {
          nodeChildren.push({ kind: "words", words: buffer });
          buffer = [];
        }
      };
      for (const entry of content) {
        if ("word" in entry) {
          buffer.push(entry.word);
        } else {
          flush();
          nodeChildren.push(walk(entry.object));
        }
      }
      flush();

      return {
        kind: "object",
        object,
        color: colors.get(object.level) ?? null,
        depth: object.depth,
        children: nodeChildren,
      };
    };

    for (const root of roots) {
      items.push(walk(root));
    }

    return { verse, items };
  });
}
