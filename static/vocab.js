let words = [];
let idx = 0;

async function init() {
  words = await fetch("/vocab/api/words").then(r=>r.json());
  idx = (await fetch("/vocab/api/progress").then(r=>r.json())).index;
  show();
}

function show() {
  document.getElementById("word").innerText = words[idx].en;
}

async function save() {
  await fetch("/vocab/api/progress", {
    method:"POST",
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({index:idx})
  });
}

function know(){
  idx++; save(); show();
}

function dont(){
  fetch("/vocab/api/unknown", {
    method:"POST",
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:"add", number:words[idx].num})
  });
  idx++; save(); show();
}

function back(){
  idx--;
  fetch("/vocab/api/unknown", {
    method:"POST",
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:"remove", number:words[idx].num})
  });
  save(); show();
}

init();