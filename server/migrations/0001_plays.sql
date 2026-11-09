-- Uma linha por partida tocada pelo bot. Sem nada pessoal: nem IP, nem navegador, nem login.
CREATE TABLE plays (
  install_id   TEXT    NOT NULL,          -- id aleatório da instalação (UUID gerado pela extensão)
  play_id      TEXT    NOT NULL,          -- id aleatório da partida (reenvio não duplica)
  version      TEXT    NOT NULL,          -- versão da extensão
  received_at  INTEGER NOT NULL,          -- epoch ms, relógio do servidor
  started_at   INTEGER,                   -- epoch ms, relógio do usuário
  ended_at     INTEGER,
  title        TEXT,
  artist       TEXT,
  difficulty   TEXT,
  mode         TEXT,
  duration     INTEGER,                   -- segundos
  reached      INTEGER,                   -- até onde chegou, segundos
  completed    INTEGER NOT NULL,          -- 1 = chegou na tela de resultado
  score        INTEGER,
  max_combo    INTEGER,
  percentage   REAL,
  notes_hit    INTEGER,
  overstrums   INTEGER,
  notes_missed INTEGER,
  special      TEXT,                      -- "a/b"
  presses      INTEGER,
  pauses       INTEGER,
  PRIMARY KEY (install_id, play_id)
);
CREATE INDEX plays_received ON plays (received_at);
CREATE INDEX plays_song ON plays (title, artist);
