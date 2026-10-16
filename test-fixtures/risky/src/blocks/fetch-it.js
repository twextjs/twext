export function fetchIt({ URL }) {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", URL);
  return fetch(URL).then((response) => response.text());
}
