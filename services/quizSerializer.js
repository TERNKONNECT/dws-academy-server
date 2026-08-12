/**
 * Quiz shaping, in one place, so no route can accidentally ship the answer key.
 *
 * `correctIndex` and `sampleAnswer` are answers. They exist only for `gradeQuiz`,
 * which runs on the server. Learner-facing responses go through `publicQuiz`;
 * only the author's own management views use `authorQuiz`.
 */

export function normalizeQuestion(question, index) {
  const options =
    question.options ??
    [
      question.optionA,
      question.optionB,
      question.optionC,
      question.optionD,
    ].filter((option) => option !== undefined && option !== null);

  const correctAnswer =
    question.correctIndex ??
    question.correctAnswer ??
    (typeof question.answer === "number" ? question.answer : undefined);

  return {
    ...question,
    _id: question._id ?? question.id ?? `q-${index}`,
    text: question.text ?? question.question ?? "",
    options: Array.isArray(options) ? options : [],
    correctIndex: Number.isInteger(correctAnswer) ? correctAnswer : 0,
    type: question.type === "theory" ? "theory" : "mcq",
    sampleAnswer: question.sampleAnswer ?? "",
  };
}

/** Full quiz including answers. Server-side grading and author views only. */
export function authorQuiz(quiz) {
  if (!quiz) return null;
  const data = quiz.toJSON ? quiz.toJSON() : quiz;
  return {
    ...data,
    questions: (data.questions ?? []).map(normalizeQuestion),
  };
}

function stripAnswers(question) {
  // Deliberately rebuilt field by field rather than deleted from a copy, so a new
  // answer-bearing field added to the question shape can't leak by default.
  return {
    _id: question._id,
    text: question.text,
    options: question.options,
    type: question.type,
    explanation: question.explanation ?? "",
  };
}

/** Quiz as a learner may see it: questions and options, no answers. */
export function publicQuiz(quiz) {
  const full = authorQuiz(quiz);
  if (!full) return null;
  return {
    ...full,
    questions: full.questions.map(stripAnswers),
  };
}

/**
 * Quiz as it appears inside a course payload: identity always, questions only when
 * the caller has access to the course content.
 */
export function publicQuizOutline(quiz, { includeQuestions = false } = {}) {
  if (!quiz) return null;
  const data = quiz.toJSON ? quiz.toJSON() : quiz;
  const outline = {
    id: data.id,
    moduleId: data.moduleId,
    title: data.title,
    description: data.description ?? "",
    questionCount: (data.questions ?? []).length,
  };
  if (!includeQuestions) return outline;
  return { ...outline, questions: publicQuiz(quiz).questions };
}

/** Grades a submission. Only ever called with an `authorQuiz` shape. */
export function gradeQuiz(quiz, answers = {}, passPercentage = 80) {
  const questions = (quiz.questions ?? []).map(normalizeQuestion);
  const gradable = questions.filter((question) => question.type !== "theory");

  const score = gradable.reduce((total, question) => {
    const answer = answers[question._id] ?? answers[question.id];
    return total + (Number(answer) === question.correctIndex ? 1 : 0);
  }, 0);

  const percentage =
    gradable.length > 0 ? Math.round((score / gradable.length) * 100) : 100;

  return {
    score,
    totalQuestions: gradable.length,
    percentage,
    passed: percentage >= passPercentage,
  };
}
