UPDATE `schedule_blocks`
SET `end_time` = '11:15',
    `title` = 'Avance informativo y grabación avance informativo'
WHERE `resource` = 'estudio'
  AND `program` = 'NOTICIERO MEDIO DIA'
  AND `start_time` = '11:00'
  AND `end_time` = '11:30';

UPDATE `schedule_blocks`
SET `start_time` = '12:00',
    `end_time` = '12:15',
    `title` = 'Grabación cápsulas Espectáculos · Cultura'
WHERE `resource` = 'estudio'
  AND `program` = 'NOTICIERO MEDIO DIA'
  AND `start_time` = '11:30'
  AND `end_time` = '12:30';
