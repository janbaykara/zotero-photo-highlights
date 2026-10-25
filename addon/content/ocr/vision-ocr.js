function run(argv) {
  ObjC.import("Foundation");
  try {
    ObjC.import("Vision");
    ObjC.import("AppKit");
    emit(recognize(argv));
  } catch (error) {
    emit({
      ok: false,
      reason: "recognize-failed",
      detail: String(error),
    });
  }
}

function emit(payload) {
  const json = JSON.stringify(payload) + "\n";
  const data = $.NSString.alloc
    .initWithString(json)
    .dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

function recognize(argv) {
  let spec = {};
  try {
    spec = JSON.parse(String((argv && argv[1]) || "{}"));
  } catch (error) {
    return { ok: false, reason: "bad-args" };
  }
  const imagePath = String((argv && argv[0]) || "");
  if (!imagePath) {
    return { ok: false, reason: "bad-args" };
  }
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(imagePath)) {
    return { ok: false, reason: "recognize-failed", detail: "missing-image" };
  }

  const attempts = [];
  const tag = preferredTag(spec);
  if (tag) {
    attempts.push({ mode: "language", tag: tag });
  }
  attempts.push({ mode: "auto" });

  let sawEmpty = false;
  let detail = "";
  for (let index = 0; index < attempts.length; index++) {
    const outcome = performAttempt(imagePath, attempts[index]);
    if (outcome.failed) {
      detail = outcome.detail || detail;
      continue;
    }
    if (countWords(outcome.lines) > 0) {
      return {
        ok: true,
        width: outcome.width,
        height: outcome.height,
        lines: outcome.lines,
      };
    }
    sawEmpty = true;
  }
  if (sawEmpty) {
    return { ok: false, reason: "no-text", detail: detail };
  }
  return {
    ok: false,
    reason: "recognize-failed",
    detail: detail || "recognize-failed",
  };
}

function preferredTag(spec) {
  if (spec && spec.tags && spec.tags.length) {
    return String(spec.tags[0]);
  }
  if (spec && spec.prefix) {
    return String(spec.prefix);
  }
  return "";
}

function performAttempt(imagePath, attempt) {
  try {
    const request = $.VNRecognizeTextRequest.alloc.init;
    request.recognitionLevel = 0;
    request.usesLanguageCorrection = true;
    if (attempt.mode === "auto") {
      request.automaticallyDetectsLanguage = true;
    } else {
      const language = $.NSString.alloc.initWithString(attempt.tag);
      request.recognitionLanguages = $.NSArray.arrayWithObject(language);
    }
    const url = $.NSURL.fileURLWithPath(imagePath);
    const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(
      url,
      $.NSDictionary.dictionary,
    );
    const error = Ref();
    const recognized = handler.performRequestsError(
      $.NSArray.arrayWithObject(request),
      error,
    );
    if (!recognized) {
      return {
        failed: true,
        detail: errorText(error[0]),
        lines: [],
        width: 0,
        height: 0,
      };
    }
    const size = imageSize(url);
    return {
      failed: false,
      detail: "",
      lines: collectLines(request),
      width: size.width,
      height: size.height,
    };
  } catch (error) {
    return {
      failed: true,
      detail: String(error),
      lines: [],
      width: 0,
      height: 0,
    };
  }
}

function errorText(error) {
  try {
    if (error && error.localizedDescription) {
      return String(ObjC.unwrap(error.localizedDescription));
    }
  } catch (ignored) {
    // The request failed without a readable message.
  }
  return "recognize-failed";
}

function imageSize(url) {
  const image = $.NSImage.alloc.initWithContentsOfURL(url);
  if (!image || !image.representations || image.representations.count < 1) {
    return { width: 0, height: 0 };
  }
  const rep = image.representations.objectAtIndex(0);
  return {
    width: Number(rep.pixelsWide || image.size.width || 0),
    height: Number(rep.pixelsHigh || image.size.height || 0),
  };
}

function collectLines(request) {
  const lines = [];
  const results = request.results;
  const count = results ? results.count : 0;
  for (let index = 0; index < count; index++) {
    lines.push(lineFromObservation(results.objectAtIndex(index)));
  }
  return lines;
}

function lineFromObservation(observation) {
  const candidates = observation.topCandidates(1);
  if (!candidates || candidates.count < 1) {
    return { words: [] };
  }
  const candidate = candidates.objectAtIndex(0);
  const ns = candidate.string;
  const confidence = Number(candidate.confidence);
  const words = [];
  try {
    ns.enumerateSubstringsInRangeOptionsUsingBlock(
      $.NSMakeRange(0, ns.length),
      $.NSStringEnumerationByWords,
      function (substr, substrRange) {
        if (!substr || !substrRange) {
          return;
        }
        try {
          const wordError = Ref();
          const box = candidate.boundingBoxForRangeError(
            substrRange,
            wordError,
          );
          if (!box || !box.boundingBox) {
            return;
          }
          const rect = box.boundingBox;
          words.push({
            text: String(ObjC.unwrap(substr)),
            confidence: confidence,
            x: rect.origin.x,
            y: rect.origin.y,
            w: rect.size.width,
            h: rect.size.height,
          });
        } catch (ignored) {
          // One token without a box does not discard the line.
        }
      },
    );
  } catch (ignored) {
    // Fall through to the line rectangle.
  }
  if (words.length) {
    return { words: words };
  }
  return { words: wordsFromLine(ns, observation.boundingBox, confidence) };
}

function wordsFromLine(ns, lineBox, confidence) {
  let text = "";
  try {
    text = String(ObjC.unwrap(ns) || "");
  } catch (ignored) {
    text = "";
  }
  const parts = text.split(/\s+/).filter(function (part) {
    return part.length > 0;
  });
  if (!parts.length || !lineBox || !lineBox.size) {
    return [];
  }
  const total =
    parts.reduce(function (sum, part) {
      return sum + part.length;
    }, 0) || 1;
  let cursor = lineBox.origin.x;
  const width = lineBox.size.width;
  return parts.map(function (part) {
    const slice = width * (part.length / total);
    const word = {
      text: part,
      confidence: confidence,
      x: cursor,
      y: lineBox.origin.y,
      w: slice,
      h: lineBox.size.height,
    };
    cursor += slice;
    return word;
  });
}

function countWords(lines) {
  let count = 0;
  for (let index = 0; index < lines.length; index++) {
    count += lines[index].words ? lines[index].words.length : 0;
  }
  return count;
}
