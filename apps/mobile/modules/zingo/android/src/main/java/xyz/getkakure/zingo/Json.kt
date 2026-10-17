package xyz.getkakure.zingo

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * The binding answers in JSON text; JS gets plain maps and lists. Numbers stay
 * as org.json parsed them (Int, Long or Double); JSON null becomes null.
 */
internal fun parseJSON(text: String): Any? {
  val value = try {
    val tokener = JSONTokener(text)
    val parsed = tokener.nextValue()
    // nextClean() reads '\u0000' once the input is exhausted: one value, nothing after it.
    if (tokener.nextClean() != '\u0000') throw JSONException("trailing text")
    parsed
  } catch (error: JSONException) {
    throw ZingoError.malformedReply(text.take(200))
  }
  // org.json reads an unquoted word ("Sync task is not complete.") as a string; JSON never has one.
  if (value is String && !text.trimStart().startsWith("\"")) {
    throw ZingoError.malformedReply(text.take(200))
  }
  return plain(value)
}

internal fun parseObject(text: String): Map<String, Any?> =
  asObject(parseJSON(text)) ?: throw ZingoError.malformedReply(text.take(200))

/** A parsed JSON object; `plain` only ever builds `Map<String, Any?>`. */
@Suppress("UNCHECKED_CAST")
internal fun asObject(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

/** A JSON array of strings, or null when it is anything else (Swift's `as? [String]`). */
internal fun stringList(value: Any?): List<String>? {
  val list = value as? List<*> ?: return null
  if (!list.all { it is String }) return null
  return list.map { it as String }
}

private fun plain(value: Any?): Any? = when (value) {
  null, JSONObject.NULL -> null
  is JSONObject -> LinkedHashMap<String, Any?>().also { map ->
    value.keys().forEach { key -> map[key] = plain(value.opt(key)) }
  }
  is JSONArray -> List(value.length()) { index -> plain(value.opt(index)) }
  else -> value
}
