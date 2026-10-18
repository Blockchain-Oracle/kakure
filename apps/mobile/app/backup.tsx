import * as Zingo from "@zingo";
import * as LocalAuthentication from "expo-local-authentication";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { ShieldCheck } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { QUIZ_CHOICES, QUIZ_WORDS, SCREENSHOT_NOTE } from "@/constants";
import { fire } from "@/feedback/fire";
import { Button } from "@/kit/button";
import { PressScale } from "@/kit/press";
import { SheetBody } from "@/kit/screen";
import { EmptyState, Skeleton, Strip } from "@/kit/states";
import { Txt } from "@/kit/text";
import type { Theme } from "@/theme/theme";
import { useThemed } from "@/theme/theme-provider";

/**
 * Seed backup (C10, surfaces.md Backup): the recovery words behind the device lock, screenshots blocked, then a
 * three-word quiz before it counts as backed up. The words never leave this screen.
 */
function styles(theme: Theme) {
  return StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    word: {
      width: "48%",
      flexDirection: "row",
      gap: theme.space.sm,
      paddingVertical: theme.space.md,
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.card,
    },
    choices: { gap: theme.space.sm },
    choice: {
      paddingVertical: theme.space.lg,
      paddingHorizontal: theme.space.lg,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.card,
    },
  });
}

/** Uint32 values span 0..2^32. */
const WORD_RANGE = 4_294_967_296;

/** Unbiased random index below `count` (crypto.getRandomValues, rejection sampling). */
function randomBelow(count: number): number {
  const range = WORD_RANGE;
  const limit = range - (range % count);
  for (;;) {
    const [word = 0] = crypto.getRandomValues(new Uint32Array(1));
    if (word < limit) return word % count;
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = randomBelow(index + 1);
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

function quizFor(words: readonly string[]) {
  const positions = shuffle(words.map((_, index) => index))
    .slice(0, QUIZ_WORDS)
    .sort((a, b) => a - b);
  return positions.map((position) => {
    const others = shuffle(words.filter((_, index) => index !== position)).slice(0, QUIZ_CHOICES - 1);
    return { position, answer: words[position] ?? "", choices: shuffle([words[position] ?? "", ...others]) };
  });
}

export default function Backup() {
  usePreventScreenCapture("backup");
  const s = useThemed(styles);
  const { firstRun } = useLocalSearchParams<{ firstRun?: string }>();
  const [words, setWords] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<"words" | "quiz" | "done">("words");
  const [question, setQuestion] = useState(0);
  const [miss, setMiss] = useState(false);
  const quiz = useMemo(() => (words ? quizFor(words) : []), [words]);

  useEffect(() => {
    void (async () => {
      try {
        if ((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())) {
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Show your recovery words" });
          if (!result.success) {
            setProblem("The words stay hidden until this phone's owner unlocks them.");
            return;
          }
        }
        setWords((await Zingo.revealSeed()).words);
      } catch (error) {
        setProblem((error as Error).message);
      }
    })();
  }, []);

  const finish = () => {
    if (firstRun) router.replace("/lock-offer");
    else router.back();
  };

  if (problem)
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Recovery words"
        reason={problem}
        action={{ label: "Close", onPress: () => router.back() }}
      />
    );
  if (!words) {
    return (
      <SheetBody title="Your recovery words" secret>
        <Skeleton style={{ height: 320, borderRadius: 20 }} />
      </SheetBody>
    );
  }

  if (step === "words") {
    return (
      <SheetBody
        secret
        title="Your recovery words"
        subtitle="Write them down in order. Anyone with these words owns this wallet; nobody, Kakure included, can restore it without them."
      >
        <View style={s.grid} accessibilityLabel="Recovery words">
          {words.map((word, index) => (
            <View key={`${index}-${word}`} style={s.word}>
              <Txt variant="rowDetail" tone="text3">
                {index + 1}
              </Txt>
              <Txt variant="rowStrong">{word}</Txt>
            </View>
          ))}
        </View>
        <Strip>{SCREENSHOT_NOTE}</Strip>
        <Button label="I wrote them down" onPress={() => setStep("quiz")} />
        {firstRun ? <Button label="Back up later" variant="quiet" size="sm" onPress={finish} /> : null}
      </SheetBody>
    );
  }

  if (step === "quiz") {
    const current = quiz[question];
    if (!current) return null;
    return (
      <SheetBody
        secret
        title={`Word ${current.position + 1}?`}
        subtitle={`Check ${question + 1} of ${quiz.length}. Pick the word from your list.`}
      >
        <View style={s.choices}>
          {current.choices.map((choice, index) => (
            <PressScale
              key={`${index}-${choice}`}
              style={s.choice}
              accessibilityLabel={choice}
              onPress={() => {
                if (choice !== current.answer) {
                  setMiss(true);
                  fire("error");
                  return;
                }
                setMiss(false);
                if (question + 1 < quiz.length) setQuestion(question + 1);
                else {
                  fire("confirmed");
                  setStep("done");
                }
              }}
            >
              <Txt variant="rowStrong">{choice}</Txt>
            </PressScale>
          ))}
        </View>
        {miss ? (
          <Txt variant="rowDetail" tone="destructive">
            Not that one. Check your list and try again.
          </Txt>
        ) : null}
        <Button label="Show the words again" variant="secondary" size="md" onPress={() => setStep("words")} />
      </SheetBody>
    );
  }

  return (
    <EmptyState
      icon={ShieldCheck}
      title="Backed up"
      reason="Your words match. Keep the paper somewhere safe and offline."
      action={{ label: firstRun ? "Continue" : "Done", onPress: finish }}
    />
  );
}
